from drsai.modules.components.skills import SkillLoader


loader = SkillLoader(
    skills_dir=[
        "/home/xiongdb/drsai_dev/examples/agent_groupchat/assistant_skill/skills",
        "/home/xiongdb/drsai_dev/examples/agent_groupchat/assistant_skill/drsai_assistant/system_skill"
    ]
)
# print(loader.get_descriptions())
# print(loader.list_skills())
print(loader.get_skill_content("user_system_config"))