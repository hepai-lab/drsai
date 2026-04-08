from drsai.modules.agents.skills_agent.managers import (
    UserProfileManager,
    TodoManager,
    get_operator_funcs,
    _detect_powershell,
)

is_powershell = _detect_powershell()
print(f"Is powershell: {is_powershell}")