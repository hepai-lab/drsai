

class TodoManager:
    """Task list manager with constraints. See v2 for details."""

    def __init__(self):
        self.items = []
        self._last_warning = None

    def update(self, items: list) -> str:
        validated = []
        in_progress_indices = []

        for i, item in enumerate(items):
            content = str(item.get("content", "")).strip()
            status = str(item.get("status", "pending")).lower()
            # active = str(item.get("activeForm", "")).strip()

            # if not content or not active:
            #     raise ValueError(f"Item {i}: content and activeForm required")
            if not content:
                raise ValueError(f"Item {i}: content and activeForm required")
            if status not in ("pending", "in_progress", "completed"):
                raise ValueError(f"Item {i}: invalid status")
            if status == "in_progress":
                in_progress_indices.append(i)

            validated.append({
                "content": content,
                "status": status,
                # "activeForm": active
            })

        # Auto-correct: when multiple in_progress, keep only one
        self._last_warning = None
        if len(in_progress_indices) > 1:
            # C-strategy: prefer keeping the old in_progress task (by content match)
            old_in_progress_contents = {
                t["content"] for t in self.items if t["status"] == "in_progress"
            }

            keep_index = None
            # Search new in_progress items for a match with old in_progress
            for idx in in_progress_indices:
                if validated[idx]["content"] in old_in_progress_contents:
                    keep_index = idx
                    break

            # Fallback: old in_progress not found in new list (completed/deleted/renamed)
            if keep_index is None:
                keep_index = in_progress_indices[0]

            # Downgrade all other in_progress → pending
            downgraded_contents = []
            for idx in in_progress_indices:
                if idx != keep_index:
                    validated[idx]["status"] = "pending"
                    downgraded_contents.append(validated[idx]["content"])

            # Generate warning feedback for the LLM
            self._last_warning = (
                f"⚠️ Auto-corrected: Only one task can be in_progress. "
                f"Task '{validated[keep_index]['content']}' kept as in_progress, "
                f"the following tasks were changed to pending: {downgraded_contents}. "
                f"Please update only one task to in_progress at a time."
            )

        self.items = validated[:20]
        return self.render()

    def get_task_prompt(self) -> str:
        """Returns the description of a task."""
        todo_list = self.render()
        return f"""Below is the current task list and status. You need to call the corresponding tool, skill, or sub agent according to the task status below to execute the subtasks with a status of "in_progress": \n\n{todo_list}"""
        
    def render(self) -> str:
        if not self.items:
            return "No todos."
        lines = []
        for t in self.items:
            mark = "[x]" if t["status"] == "completed" else \
                   "[>]" if t["status"] == "in_progress" else "[ ]"
            lines.append(f"{mark} {t['content']}")
        done = sum(1 for t in self.items if t["status"] == "completed")
        return "\n".join(lines) + f"\n({done}/{len(self.items)} done)"