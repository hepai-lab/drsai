from pathlib import Path
import sys


ROOT = Path(__file__).parents[5]
sys.path.insert(0, str(ROOT / "scripts"))
from android_p9_legacy_path_gate import python_kernel_gate  # noqa: E402


def write(path: Path, value: str) -> Path:
    path.write_text(value, encoding="utf-8")
    return path


def test_alias_and_shared_factory_are_the_only_legacy_compatibility_surface(tmp_path: Path) -> None:
    engine = write(tmp_path / "engine.py", '''
class DrSaiAgentKernel: pass
MobileAgentCore = DrSaiAgentKernel
def create_mobile_agent_core():
    from factory import create_agent_kernel
    return create_agent_kernel(surface="android")
''')
    factory = write(tmp_path / "factory.py", 'def f(surface):\n    return create_agent_kernel(surface=surface)\n')
    probe = write(tmp_path / "probe.py", 'core = create_agent_kernel(surface="android")\n')
    assert all(python_kernel_gate(engine, factory, probe).values())


def test_independent_mobile_loop_direct_constructor_and_probe_bypass_fail_closed(tmp_path: Path) -> None:
    factory = write(tmp_path / "factory.py", 'def f(surface):\n    return create_agent_kernel(surface=surface)\n')
    probe = write(tmp_path / "probe.py", 'core = create_agent_kernel(surface="android")\n')
    independent = write(tmp_path / "independent.py", 'class MobileAgentCore: pass\n')
    assert not python_kernel_gate(independent, factory, probe)["mobile_agent_core_has_no_independent_class"]
    direct = write(tmp_path / "direct.py", '''
class DrSaiAgentKernel: pass
MobileAgentCore = DrSaiAgentKernel
def create_mobile_agent_core():
    return DrSaiAgentKernel()
''')
    assert not python_kernel_gate(direct, factory, probe)["legacy_constructor_delegates_only_to_shared_factory"]
    bypass = write(tmp_path / "bypass.py", 'core = create_mobile_agent_core()\n')
    assert not python_kernel_gate(direct, factory, bypass)["android_production_probe_uses_shared_factory_directly"]
