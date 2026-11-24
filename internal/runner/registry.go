package runner

import (
	"sync"

	"nekomanage/internal/model"
)

type activeExecution struct {
	task   model.RunningTask
	cancel func()
	mu     sync.Mutex
	killed bool
}

func (a *activeExecution) markKilled() {
	a.mu.Lock()
	a.killed = true
	fn := a.cancel
	a.mu.Unlock()
	if fn != nil {
		fn()
	}
}

func (a *activeExecution) isKilled() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.killed
}

// Registry tracks all currently running script executions safely across goroutines.
type Registry struct {
	mu     sync.RWMutex
	byLog  map[int64]*activeExecution
}

func NewRegistry() *Registry {
	return &Registry{
		byLog: make(map[int64]*activeExecution),
	}
}

func (r *Registry) Register(exec *activeExecution) {
	r.mu.Lock()
	r.byLog[exec.task.LogID] = exec
	r.mu.Unlock()
}

func (r *Registry) SetPID(logID int64, pid int) {
	r.mu.Lock()
	if ex, ok := r.byLog[logID]; ok {
		ex.task.PID = pid
	}
	r.mu.Unlock()
}

func (r *Registry) Unregister(logID int64) {
	r.mu.Lock()
	delete(r.byLog, logID)
	r.mu.Unlock()
}

func (r *Registry) KillByLogID(logID int64) bool {
	r.mu.RLock()
	ex, ok := r.byLog[logID]
	r.mu.RUnlock()
	if !ok {
		return false
	}
	ex.markKilled()
	return true
}

func (r *Registry) KillByScriptID(scriptID int64) int {
	r.mu.RLock()
	var targets []*activeExecution
	for _, ex := range r.byLog {
		if ex.task.ScriptID == scriptID {
			targets = append(targets, ex)
		}
	}
	r.mu.RUnlock()
	for _, ex := range targets {
		ex.markKilled()
	}
	return len(targets)
}

func (r *Registry) KillAll() {
	r.mu.RLock()
	targets := make([]*activeExecution, 0, len(r.byLog))
	for _, ex := range r.byLog {
		targets = append(targets, ex)
	}
	r.mu.RUnlock()
	for _, ex := range targets {
		ex.markKilled()
	}
}

func (r *Registry) RunningLogIDForScript(scriptID int64) (int64, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, ex := range r.byLog {
		if ex.task.ScriptID == scriptID {
			return ex.task.LogID, true
		}
	}
	return 0, false
}

func (r *Registry) List() []model.RunningTask {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]model.RunningTask, 0, len(r.byLog))
	for _, ex := range r.byLog {
		out = append(out, ex.task)
	}
	return out
}

func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.byLog)
}
