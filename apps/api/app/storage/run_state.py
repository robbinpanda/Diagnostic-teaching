class RunStateConflict(RuntimeError):
    """Raised when work tries to commit after its durable run stopped running."""

    def __init__(self, run_id: str, status: str):
        super().__init__(f"run {run_id} is {status}")
        self.run_id = run_id
        self.status = status
