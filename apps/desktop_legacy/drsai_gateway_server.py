"""
DrSai API Server — thin launcher.

For the real app creation code, see ``drsai.backend.gateway``.

Usage:
    python drsai_api_server.py
    DRSAI_API_PORT=18642 python drsai_api_server.py
"""

if __name__ == "__main__":
    from drsai.backend.gateway import main
    main()