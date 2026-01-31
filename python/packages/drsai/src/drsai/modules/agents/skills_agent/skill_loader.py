from pathlib import Path
import re
from pydantic import BaseModel
from drsai.modules.components import ComponentBase, Component

class SkillLoaderConfig(BaseModel):
    """Configuration for SkillLoader."""
    skills_dir: str

class SkillLoader(Component[SkillLoaderConfig], ComponentBase[BaseModel]):
    """
    Loads and manages skills from SKILL.md files.

    A skill is a FOLDER containing:
    - SKILL.md (required): YAML frontmatter + markdown instructions
    - scripts/ (optional): Helper scripts the model can run
    - references/ (optional): Additional documentation
    - assets/ (optional): Templates, files for output

    SKILL.md Format:
    ----------------
        ---
        name: pdf
        description: Process PDF files. Use when reading, creating, or merging PDFs.
        ---

        # PDF Processing Skill

        ## Reading PDFs

        Use pdftotext for quick extraction:
        ```bash
        pdftotext input.pdf -
        ```
        ...

    The YAML frontmatter provides metadata (name, description).
    The markdown body provides detailed instructions.
    """

    component_config_schema = SkillLoaderConfig
    component_provider_override = "drsai.modules.agents.skills_agent.skill_loader.SkillLoader"
    component_type =  "skill_loader"

    def __init__(self, skills_dir: str):
        skills_dir_p = self.safe_path(skills_dir)
        self.skills_dir = skills_dir_p
        self.skills = {}
        self.load_skills()

    def safe_path(self, path: str) -> Path:
        """Make sure path is safe and exists."""
        path_obj = Path(path)
        resolved_path = path_obj.resolve()
        # if ".." in path.split("/") or ".." in path.split("\\"):
        #     try:
        #         resolved_path.relative_to(Path.cwd())
        #     except ValueError:
        #         raise ValueError(f"Unsafe path detected: {path}")
        if not resolved_path.exists():
            raise ValueError(f"Path does not exist: {path}")
        return resolved_path
    
    def parse_skill_md(self, path: Path) -> dict:
        """
        Parse a SKILL.md file into metadata and body.

        Returns dict with: name, description, body, path, dir
        Returns None if file doesn't match format.
        """
        content = path.read_text()

        # Match YAML frontmatter between --- markers
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
        if not match:
            return None

        frontmatter, body = match.groups()

        # Parse YAML-like frontmatter (simple key: value)
        metadata = {}
        for line in frontmatter.strip().split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                metadata[key.strip()] = value.strip().strip("\"'")

        # Require name and description
        if "name" not in metadata or "description" not in metadata:
            return None

        return {
            "name": metadata["name"],
            "description": metadata["description"],
            "body": body.strip(),
            "path": path,
            "dir": path.parent,
        }

    def load_skills(self):
        """
        Scan skills directory and load all valid SKILL.md files.

        Only loads metadata at startup - body is loaded on-demand.
        This keeps the initial context lean.
        """
        if not self.skills_dir.exists():
            return

        for skill_dir in self.skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue

            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue

            skill = self.parse_skill_md(skill_md)
            if skill:
                self.skills[skill["name"]] = skill

    def get_descriptions(self) -> str:
        """
        Generate skill descriptions for system prompt.

        This is Layer 1 - only name and description, ~100 tokens per skill.
        Full content (Layer 2) is loaded only when Skill tool is called.
        """
        if not self.skills:
            return "(no skills available)"

        return "\n".join(
            f"- {name}: {skill['description']}"
            for name, skill in self.skills.items()
        )

    def get_skill_content(self, name: str) -> str:
        """
        Get full skill content for injection.

        This is Layer 2 - the complete SKILL.md body, plus any available
        resources (Layer 3 hints).

        Returns None if skill not found.
        """
        if name not in self.skills:
            return None

        skill = self.skills[name]
        content = f"# Skill: {skill['name']}\n\n{skill['body']}"

        # List available resources (Layer 3 hints)
        resources = []
        for folder, label in [
            ("scripts", "Scripts"),
            ("references", "References"),
            ("assets", "Assets")
        ]:
            folder_path = skill["dir"] / folder
            if folder_path.exists():
                files = list(folder_path.glob("*"))
                if files:
                    resources.append(f"{label}: {', '.join(f.name for f in files)}")

        if resources:
            content += f"\n\n**Available resources in {skill['dir']}:**\n"
            content += "\n".join(f"- {r}" for r in resources)

        return content

    def list_skills(self) -> list:
        """Return list of available skill names."""
        return list(self.skills.keys())
    
    def run_skill(self, skill_name: str) -> str:
        """
        Load a skill and inject it into the conversation.

        This is the key mechanism:
        1. Get skill content (SKILL.md body + resource hints)
        2. Return it wrapped in <skill-loaded> tags
        3. Model receives this as tool_result (user message)
        4. Model now "knows" how to do the task

        Why tool_result instead of system prompt?
        - System prompt changes invalidate cache (20-50x cost increase)
        - Tool results append to end (prefix unchanged, cache hit)

        This is how production systems stay cost-efficient.
        """
        content = self.get_skill_content(skill_name)

        if content is None:
            available = ", ".join(self.list_skills()) or "none"
            return f"Error: Unknown skill '{skill_name}'. Available: {available}"

        # Wrap in tags so model knows it's skill content
        return f"""<skill-loaded name="{skill_name}">
    {content}
    </skill-loaded>

    Follow the instructions in the skill above to complete the user's task."""
        

if __name__ == "__main__":
    loader = SkillLoader(Path("/home/xiongdb/drsai_dev/examples/agent_groupchat/assistant_skill/skills"))
    # print(loader.get_descriptions())
    print(loader.list_skills())
    # print(loader.get_skill_content("pdf"))