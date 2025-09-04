from drsai.modules.managers.database.db_manager import DatabaseManager
from drsai.modules.managers.datamodel.types import Response
from drsai.modules.managers.datamodel.db import UserInput
from drsai.configs.constant import FS_DIR
from sqlmodel import Session, select
import json

database_manager: DatabaseManager = DatabaseManager(
    engine_uri = f"sqlite:///{FS_DIR}/drsai.db",
    base_dir = FS_DIR
    )
# Initialize database
init_response = database_manager.initialize_database(auto_upgrade=True)
print(f"Database initialization: {init_response.status}")
assert init_response.status, init_response.message


def test_user_input_crud():
    """Test CRUD operations for UserInput"""
        
    # CREATE - Test creating new UserInput
    print("\n=== CREATE TEST ===")
    new_user_input = UserInput(
        user_id="test_user@example.com",
        thread_id="thread_001",
        user_messages=[
            {"role": "user", "content": "Hello, how are you?"},
            {"role": "assistant", "content": "I'm doing well, thank you!"}
        ],
        api_key="test_api_key_123",
        extra_requests={"priority": "high", "lang": "en"}
    )
    
    new_user_input:Response = database_manager.upsert(new_user_input, return_json=False)
    print(f"Created UserInput with ID: {new_user_input.data.id}")
    print(f"Created at: {new_user_input.data.created_at}")
    print(f"User messages: {new_user_input.data.user_messages}")
    
    # READ - Test reading UserInput
    print("\n=== READ TEST ===")
    user_inputs=database_manager.get(
        UserInput, 
        filters={"user_id": "test_user@example.com", "thread_id": "thread_001"},
        return_json=False)
    user_input = None
    if user_inputs.data:
        user_input=user_inputs.data[0]
        print(f"Found UserInput: ID={user_input.id}, User={user_input.user_id}")
        print(f"Thread: {user_input.thread_id}")
        print(f"Messages count: {len(user_input.user_messages)}")
        print(f"Extra requests: {user_input.extra_requests}")
    
    # UPDATE - Test updating UserInput
    print("\n=== UPDATE TEST ===")
    if user_input:
        user_input.user_messages.append({
            "role": "user", 
            "content": "Can you help me with something?"
        })
        user_input.extra_requests = {"priority": "medium", "lang": "zh"}
        user_input.version = "0.0.2"
        
        new_user_input:Response = database_manager.upsert(user_input, return_json=False)
        print(f"Updated UserInput ID: {user_input.id}")
        print(f"Updated at: {user_input.updated_at}")
        print(f"New messages count: {len(user_input.user_messages)}")
        print(f"Updated extra_requests: {user_input.extra_requests}")
        print(f"New version: {user_input.version}")
    
   
    # DELETE - Test deleting UserInput
    print("\n=== DELETE TEST ===")
    if user_input:
        user_input_id = user_input.id
        database_manager.delete(
            UserInput, 
            filters={
                "id": user_input_id,
                "user_id": "test_user@example.com", 
                "thread_id": "thread_001"}
        )
        print(f"Deleted UserInput with ID: {user_input_id}")
        
        # Verify deletion
        deleted_user_input:Response = database_manager.get(UserInput, filters={"id": user_input_id}, return_json=False)
        if deleted_user_input is None:
            print("Deletion confirmed - record not found")
        else:
            print("ERROR: Record still exists after deletion")

# SQL内部操作测试
def test_multiple_user_inputs():
    """Test creating multiple UserInput records"""
    print("\n\n=== MULTIPLE RECORDS TEST ===")
    
    with Session(database_manager.engine) as session:
        # Create multiple users
        users_data = [
            {
                "user_id": "alice@example.com",
                "thread_id": "thread_alice_001",
                "user_messages": [{"role": "user", "content": "Hello Alice here"}],
                "api_key": "alice_key_123"
            },
            {
                "user_id": "bob@example.com", 
                "thread_id": "thread_bob_001",
                "user_messages": [{"role": "user", "content": "Hi, Bob speaking"}],
                "api_key": "bob_key_456"
            }
        ]
        
        for user_data in users_data:
            user_input = UserInput(**user_data)
            session.add(user_input)
        
        session.commit()
        
        # Query all users
        all_users = session.exec(select(UserInput)).all()
        print(f"Created {len(all_users)} user records:")
        for user in all_users:
            print(f"  - {user.user_id} (ID: {user.id})")
        
        # Clean up
        for user in all_users:
            session.delete(user)
        session.commit()
        print("Cleaned up all test records")

if __name__ == "__main__":
    test_user_input_crud()
    # test_multiple_user_inputs()
    # from autogen_agentchat.messages import TextMessage
    # print(TextMessage(content="hi", source="role", metadata={"internal": "no"}).model_dump(mode="json"))

