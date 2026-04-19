"""
Test script for Bash Task Persistence

Run this to verify that task persistence and recovery work correctly.
"""

import sys
import time
import tempfile
from pathlib import Path
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent / "python" / "packages" / "drsai" / "src"))

from drsai.modules.agents.skills_agent.managers.bash_task_persistence import BashTaskPersistence
from drsai.modules.agents.skills_agent.managers.bash_task_recovery import BashTaskRecovery


def test_basic_persistence():
    """Test basic save and load functionality."""
    print("\n=== Test 1: Basic Persistence ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        worker_dir = Path(tmpdir)
        thread_id = "test_thread_001"

        # Create persistence manager
        persistence = BashTaskPersistence(worker_dir, thread_id)

        # Create a test task
        task_info = {
            "task_id": "bash_task_abc123",
            "command": "sleep 10",
            "status": "running",
            "pid": 12345,
            "pgid": 12345,
            "start_time": datetime.now().isoformat(),
            "timeout": 500.0
        }

        # Save task
        success = persistence.save_task("bash_task_abc123", task_info)
        assert success, "Failed to save task"
        print("✓ Task saved successfully")

        # Load task
        loaded_task = persistence.load_task("bash_task_abc123")
        assert loaded_task is not None, "Failed to load task"
        assert loaded_task["command"] == "sleep 10"
        print("✓ Task loaded successfully")

        # Update status
        success = persistence.update_task_status(
            "bash_task_abc123",
            "completed",
            output="Task completed successfully"
        )
        assert success, "Failed to update status"
        print("✓ Task status updated successfully")

        # Verify update
        loaded_task = persistence.load_task("bash_task_abc123")
        assert loaded_task["status"] == "completed"
        assert loaded_task["output"] == "Task completed successfully"
        print("✓ Status update verified")

        print("✅ Basic persistence test passed")


def test_multiple_tasks():
    """Test saving and loading multiple tasks."""
    print("\n=== Test 2: Multiple Tasks ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        worker_dir = Path(tmpdir)
        thread_id = "test_thread_002"

        persistence = BashTaskPersistence(worker_dir, thread_id)

        # Create multiple tasks
        tasks = {}
        for i in range(5):
            task_id = f"bash_task_{i:03d}"
            tasks[task_id] = {
                "task_id": task_id,
                "command": f"echo 'Task {i}'",
                "status": "completed" if i < 3 else "running",
                "start_time": datetime.now().isoformat(),
            }

        # Save all tasks
        success = persistence.save_tasks(tasks)
        assert success, "Failed to save tasks"
        print(f"✓ Saved {len(tasks)} tasks")

        # Load all tasks
        loaded_tasks = persistence.load_all_tasks()
        assert len(loaded_tasks) == 5, f"Expected 5 tasks, got {len(loaded_tasks)}"
        print(f"✓ Loaded {len(loaded_tasks)} tasks")

        # Verify contents
        for task_id in tasks:
            assert task_id in loaded_tasks
            assert loaded_tasks[task_id]["command"] == tasks[task_id]["command"]

        print("✅ Multiple tasks test passed")


def test_thread_isolation():
    """Test that tasks are isolated per thread."""
    print("\n=== Test 3: Thread Isolation ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        worker_dir = Path(tmpdir)

        # Create two different thread managers
        persistence1 = BashTaskPersistence(worker_dir, "thread_A")
        persistence2 = BashTaskPersistence(worker_dir, "thread_B")

        # Save task to thread A
        task_a = {
            "task_id": "task_a",
            "command": "echo 'Thread A'",
            "status": "completed"
        }
        persistence1.save_task("task_a", task_a)

        # Save task to thread B
        task_b = {
            "task_id": "task_b",
            "command": "echo 'Thread B'",
            "status": "completed"
        }
        persistence2.save_task("task_b", task_b)

        # Verify isolation
        tasks_a = persistence1.load_all_tasks()
        tasks_b = persistence2.load_all_tasks()

        assert "task_a" in tasks_a and "task_b" not in tasks_a
        assert "task_b" in tasks_b and "task_a" not in tasks_b

        print("✓ Thread A has only its own tasks")
        print("✓ Thread B has only its own tasks")
        print("✅ Thread isolation test passed")


def test_global_index():
    """Test global task index across threads."""
    print("\n=== Test 4: Global Index ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        worker_dir = Path(tmpdir)

        # Create tasks in multiple threads
        for thread_num in range(3):
            thread_id = f"thread_{thread_num}"
            persistence = BashTaskPersistence(worker_dir, thread_id)

            for task_num in range(2):
                task_id = f"task_{thread_num}_{task_num}"
                task_info = {
                    "task_id": task_id,
                    "command": f"echo 'Thread {thread_num} Task {task_num}'",
                    "status": "completed"
                }
                persistence.save_task(task_id, task_info)

        # Check global summary
        persistence = BashTaskPersistence(worker_dir, "thread_0")
        summary = persistence.get_global_tasks_summary()

        assert summary['total_tasks'] == 6, f"Expected 6 total tasks, got {summary['total_tasks']}"
        assert summary['completed_tasks'] == 6

        print(f"✓ Global summary shows {summary['total_tasks']} tasks across all threads")
        print("✅ Global index test passed")


def test_cleanup():
    """Test cleanup of old tasks."""
    print("\n=== Test 5: Task Cleanup ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        worker_dir = Path(tmpdir)
        thread_id = "test_thread_cleanup"

        persistence = BashTaskPersistence(worker_dir, thread_id)

        # Create some old tasks (simulate by setting old timestamps)
        old_time = datetime(2020, 1, 1).isoformat()
        recent_time = datetime.now().isoformat()

        tasks = {
            "old_task_1": {
                "task_id": "old_task_1",
                "command": "echo 'old'",
                "status": "completed",
                "saved_at": old_time
            },
            "old_task_2": {
                "task_id": "old_task_2",
                "command": "echo 'old'",
                "status": "failed",
                "saved_at": old_time
            },
            "recent_task": {
                "task_id": "recent_task",
                "command": "echo 'recent'",
                "status": "completed",
                "saved_at": recent_time
            }
        }

        persistence.save_tasks(tasks)

        # Run cleanup (tasks older than 1 day)
        deleted = persistence.cleanup_old_tasks(max_age_days=1)

        assert deleted == 2, f"Expected to delete 2 tasks, deleted {deleted}"
        print(f"✓ Cleaned up {deleted} old tasks")

        # Verify recent task still exists
        remaining = persistence.load_all_tasks()
        assert "recent_task" in remaining
        assert "old_task_1" not in remaining
        assert "old_task_2" not in remaining

        print("✓ Recent task preserved")
        print("✅ Cleanup test passed")


def test_task_recovery():
    """Test task recovery utilities."""
    print("\n=== Test 6: Task Recovery ===")

    # Create test tasks
    tasks = {
        "completed_task": {
            "task_id": "completed_task",
            "command": "echo 'done'",
            "status": "completed"
        },
        "running_task": {
            "task_id": "running_task",
            "command": "sleep 1000",
            "status": "running",
            "pid": 999999,  # Non-existent PID
            "pgid": 999999
        },
        "failed_task": {
            "task_id": "failed_task",
            "command": "exit 1",
            "status": "failed",
            "error": "Command failed"
        }
    }

    # Categorize tasks
    categorized = BashTaskRecovery.categorize_restored_tasks(tasks)

    assert len(categorized['completed']) == 1
    assert len(categorized['failed']) == 1
    assert len(categorized['orphaned']) == 1  # Running task with dead process

    print("✓ Tasks categorized correctly")
    print(f"  - Completed: {len(categorized['completed'])}")
    print(f"  - Failed: {len(categorized['failed'])}")
    print(f"  - Orphaned: {len(categorized['orphaned'])}")

    # Test notification formatting
    notification = BashTaskRecovery.format_recovery_notification(categorized)
    assert "任务恢复报告" in notification
    assert "已完成任务" in notification

    print("✓ Recovery notification generated")
    print("✅ Task recovery test passed")


def test_stats():
    """Test task statistics."""
    print("\n=== Test 7: Task Statistics ===")

    tasks = {
        f"task_{i}": {
            "task_id": f"task_{i}",
            "command": f"task {i}",
            "status": ["completed", "running", "failed", "timeout"][i % 4]
        }
        for i in range(8)
    }

    stats = BashTaskRecovery.get_task_summary_stats(tasks)

    assert stats['total'] == 8
    assert stats['completed'] == 2
    assert stats['running'] == 2
    assert stats['failed'] == 2
    assert stats['timeout'] == 2

    print("✓ Statistics calculated correctly:")
    print(f"  - Total: {stats['total']}")
    print(f"  - Running: {stats['running']}")
    print(f"  - Completed: {stats['completed']}")
    print(f"  - Failed: {stats['failed']}")
    print(f"  - Timeout: {stats['timeout']}")
    print("✅ Statistics test passed")


def test_persistence_across_restarts():
    """Simulate program restart and verify tasks persist."""
    print("\n=== Test 8: Persistence Across Restarts ===")

    with tempfile.TemporaryDirectory() as tmpdir:
        worker_dir = Path(tmpdir)
        thread_id = "test_thread_restart"

        # First "session"
        print("\n📦 Session 1: Creating tasks...")
        persistence1 = BashTaskPersistence(worker_dir, thread_id)

        tasks = {
            "task_1": {
                "task_id": "task_1",
                "command": "echo 'Session 1'",
                "status": "completed",
                "output": "Session 1"
            },
            "task_2": {
                "task_id": "task_2",
                "command": "sleep 100",
                "status": "running",
                "pid": 12345,
                "pgid": 12345
            }
        }

        persistence1.save_tasks(tasks)
        print(f"  Saved {len(tasks)} tasks")

        # Delete the persistence object (simulate program exit)
        del persistence1

        # Second "session" (simulate restart)
        print("\n🔄 Session 2: Reloading tasks...")
        persistence2 = BashTaskPersistence(worker_dir, thread_id)

        loaded_tasks = persistence2.load_all_tasks()
        print(f"  Loaded {len(loaded_tasks)} tasks")

        # Verify tasks persisted
        assert len(loaded_tasks) == 2
        assert "task_1" in loaded_tasks
        assert "task_2" in loaded_tasks
        assert loaded_tasks["task_1"]["status"] == "completed"
        assert loaded_tasks["task_2"]["status"] == "running"

        print("✓ Tasks persisted across restart")

        # Update interrupted task
        print("\n🔧 Updating interrupted tasks...")
        interrupted = BashTaskRecovery.update_interrupted_tasks(
            loaded_tasks,
            persistence2
        )

        assert len(interrupted) == 1  # task_2 should be interrupted
        assert interrupted[0]["status"] == "interrupted"

        print(f"✓ Marked {len(interrupted)} interrupted tasks")
        print("✅ Persistence across restarts test passed")


def run_all_tests():
    """Run all tests."""
    print("\n" + "="*60)
    print("  Bash Task Persistence Test Suite")
    print("="*60)

    tests = [
        test_basic_persistence,
        test_multiple_tasks,
        test_thread_isolation,
        test_global_index,
        test_cleanup,
        test_task_recovery,
        test_stats,
        test_persistence_across_restarts
    ]

    passed = 0
    failed = 0

    for test_func in tests:
        try:
            test_func()
            passed += 1
        except AssertionError as e:
            print(f"\n❌ Test failed: {test_func.__name__}")
            print(f"   Error: {e}")
            failed += 1
        except Exception as e:
            print(f"\n💥 Test error: {test_func.__name__}")
            print(f"   Error: {e}")
            failed += 1

    print("\n" + "="*60)
    print(f"  Test Results: {passed} passed, {failed} failed")
    print("="*60)

    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
