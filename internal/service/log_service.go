package service

import (
	"database/sql"
	"fmt"
	"strings"

	"nekomanage/internal/db"
	"nekomanage/internal/model"
)

// LogService provides querying, detail inspection, and retention cleanup for script execution logs.
type LogService struct {
	store    *db.Store
	settings *SettingsService
}

func NewLogService(store *db.Store, settings *SettingsService) *LogService {
	return &LogService{
		store:    store,
		settings: settings,
	}
}

// QueryLogs returns paginated execution log summaries filtered by script, failure status, trigger, or keyword.
func (s *LogService) QueryLogs(query model.LogQuery) (model.LogPage, error) {
	page := query.Page
	if page < 1 {
		page = 1
	}
	pageSize := query.PageSize
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 30
	}

	var conds []string
	var args []any

	if query.ScriptID != nil && *query.ScriptID > 0 {
		conds = append(conds, "script_id = ?")
		args = append(args, *query.ScriptID)
	}
	if query.OnlyFailed {
		conds = append(conds, "status IN ('failed', 'timeout', 'killed')")
	}
	if tt := strings.TrimSpace(query.TriggerType); tt == "manual" || tt == "schedule" {
		conds = append(conds, "trigger_type = ?")
		args = append(args, tt)
	}
	if kw := strings.TrimSpace(query.Keyword); kw != "" {
		like := "%" + kw + "%"
		conds = append(conds, "(script_name_snapshot LIKE ? OR error_message LIKE ? OR stdout_text LIKE ? OR stderr_text LIKE ?)")
		args = append(args, like, like, like, like)
	}

	where := ""
	if len(conds) > 0 {
		where = " WHERE " + strings.Join(conds, " AND ")
	}

	var total int
	if err := s.store.DB.QueryRow("SELECT COUNT(*) FROM script_logs"+where, args...).Scan(&total); err != nil {
		return model.LogPage{}, err
	}

	offset := (page - 1) * pageSize
	listArgs := append(append([]any{}, args...), pageSize, offset)
	rows, err := s.store.DB.Query(`
		SELECT id, script_id, script_name_snapshot, schedule_id, trigger_type, status,
		       exit_code, started_at, COALESCE(finished_at, ''), duration_ms, error_message,
		       (LENGTH(stdout_text) > 0 OR LENGTH(stderr_text) > 0) AS has_output
		FROM script_logs
	`+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, listArgs...)
	if err != nil {
		return model.LogPage{}, err
	}
	defer rows.Close()

	items := make([]model.LogSummary, 0)
	for rows.Next() {
		var row model.LogSummary
		var sid, schID sql.NullInt64
		var exitC sql.NullInt64
		var hasOut int
		if err := rows.Scan(
			&row.ID, &sid, &row.ScriptNameSnapshot, &schID, &row.TriggerType, &row.Status,
			&exitC, &row.StartedAt, &row.FinishedAt, &row.DurationMs, &row.ErrorMessage, &hasOut,
		); err != nil {
			return model.LogPage{}, err
		}
		if sid.Valid {
			v := sid.Int64
			row.ScriptID = &v
		}
		if schID.Valid {
			v := schID.Int64
			row.ScheduleID = &v
		}
		if exitC.Valid {
			v := int(exitC.Int64)
			row.ExitCode = &v
		}
		row.HasOutput = hasOut != 0
		items = append(items, row)
	}
	if err := rows.Err(); err != nil {
		return model.LogPage{}, err
	}

	return model.LogPage{
		Items:    items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	}, nil
}

// GetLogDetail returns the complete execution log including full stdout and stderr text.
func (s *LogService) GetLogDetail(id int64) (model.ScriptLog, error) {
	var row model.ScriptLog
	var sid, schID sql.NullInt64
	var exitC sql.NullInt64
	err := s.store.DB.QueryRow(`
		SELECT id, script_id, script_name_snapshot, schedule_id, trigger_type, status,
		       exit_code, started_at, COALESCE(finished_at, ''), duration_ms,
		       stdout_text, stderr_text, error_message
		FROM script_logs WHERE id = ?
	`, id).Scan(
		&row.ID, &sid, &row.ScriptNameSnapshot, &schID, &row.TriggerType, &row.Status,
		&exitC, &row.StartedAt, &row.FinishedAt, &row.DurationMs,
		&row.StdoutText, &row.StderrText, &row.ErrorMessage,
	)
	if err != nil {
		return model.ScriptLog{}, err
	}
	if sid.Valid {
		v := sid.Int64
		row.ScriptID = &v
	}
	if schID.Valid {
		v := schID.Int64
		row.ScheduleID = &v
	}
	if exitC.Valid {
		v := int(exitC.Int64)
		row.ExitCode = &v
	}
	return row, nil
}

// DeleteLog removes a single log entry.
func (s *LogService) DeleteLog(id int64) error {
	_, err := s.store.DB.Exec(`DELETE FROM script_logs WHERE id = ? AND status != 'running'`, id)
	return err
}

// ClearLogs removes all finished logs (optionally scoped to a single script).
func (s *LogService) ClearLogs(scriptID *int64) (int64, error) {
	var res sql.Result
	var err error
	if scriptID != nil && *scriptID > 0 {
		res, err = s.store.DB.Exec(`DELETE FROM script_logs WHERE script_id = ? AND status != 'running'`, *scriptID)
	} else {
		res, err = s.store.DB.Exec(`DELETE FROM script_logs WHERE status != 'running'`)
	}
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// RunLogCleanup enforces the retention policy (keep recent N days AND at most M rows).
func (s *LogService) RunLogCleanup() (int64, error) {
	days := 30
	maxCount := 500
	if s.settings != nil {
		cfg := s.settings.GetSettings()
		if cfg.LogRetentionDays > 0 {
			days = cfg.LogRetentionDays
		}
		if cfg.LogMaxCount > 0 {
			maxCount = cfg.LogMaxCount
		}
	}

	var deletedTotal int64

	// 1. Delete entries older than N days
	res1, err := s.store.DB.Exec(
		fmt.Sprintf(`DELETE FROM script_logs WHERE status != 'running' AND started_at < datetime('now', 'localtime', '-%d days')`, days),
	)
	if err != nil {
		return 0, err
	}
	if n, err := res1.RowsAffected(); err == nil {
		deletedTotal += n
	}

	// 2. Keep only the latest maxCount rows
	res2, err := s.store.DB.Exec(`
		DELETE FROM script_logs
		WHERE status != 'running'
		  AND id NOT IN (SELECT id FROM script_logs ORDER BY id DESC LIMIT ?)
	`, maxCount)
	if err != nil {
		return deletedTotal, err
	}
	if n, err := res2.RowsAffected(); err == nil {
		deletedTotal += n
	}

	return deletedTotal, nil
}
