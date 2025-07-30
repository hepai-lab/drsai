#!/bin/bash

# Script to delete Docker containers with specific image names
# Target images: magentic-ui-python-env and magentic-ui-vnc-browser

echo "Searching for containers with target images..."

# Get container IDs for the specified images
CONTAINER_IDS=$(docker ps -a --filter "ancestor=magentic-ui-python-env" --filter "ancestor=magentic-ui-vnc-browser" -q)

if [ -z "$CONTAINER_IDS" ]; then
    echo "No containers found with the specified images."
    exit 0
fi

echo "Found the following containers:"
docker ps -a --filter "ancestor=magentic-ui-python-env" --filter "ancestor=magentic-ui-vnc-browser"

echo ""
read -p "Are you sure you want to delete these containers? (y/N): " confirm

if [[ $confirm =~ ^[Yy]$ ]]; then
    echo "Stopping and removing containers..."
    for id in $CONTAINER_IDS; do
        echo "Stopping container $id..."
        docker stop $id
        echo "Removing container $id..."
        docker rm $id
    done
    echo "Done! All specified containers have been removed."
else
    echo "Operation cancelled."
fi