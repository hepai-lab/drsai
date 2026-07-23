import asyncio
from run_gaia import GAIARunner, GAIAConfig
import os
from dotenv import load_dotenv
load_dotenv()

config = GAIAConfig(
    dataset_path="/data/xiongdb/GAIA/2023/",
    # model_name="hepai/deepseek-v4-flash",
    model_name="hepai/deepseek-v4-pro",
    levels=[1],
    max_concurrent=3,
    per_task_timeout=600,
    # task_ids=["e1fc63a2-da7a-432f-be78-7c4a95598703"],
    db_path="/home/xiongdb/drsai_dev/tmp/gaia_eval/gaia_eval.db",
    api_key=os.environ.get("HEPAI_API_KEY")
)
runner = GAIARunner(config)
asyncio.run(runner.run())