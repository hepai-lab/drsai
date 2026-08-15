from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from drsai.backend.wechat.channel_identity import ChannelIdentity


def test_channel_identity_is_stable_scoped_and_non_reversible() -> None:
    first = ChannelIdentity(b"a" * 32)
    second_install = ChannelIdentity(b"b" * 32)

    user_key = first.provider_user_key("raw-wechat-user")
    assert user_key == first.provider_user_key("raw-wechat-user")
    assert user_key != second_install.provider_user_key("raw-wechat-user")
    assert "raw-wechat-user" not in user_key
    assert first.account_fingerprint("raw-account") != user_key
