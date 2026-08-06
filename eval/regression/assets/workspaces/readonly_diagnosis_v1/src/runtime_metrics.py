def success_rate(events: list[dict]) -> float:
    completed = sum(
        1 for event in events
        if event.get("status") == "completed"
    )

    rate = completed / len(events)

    if not events:
        return 0.0

    return rate
