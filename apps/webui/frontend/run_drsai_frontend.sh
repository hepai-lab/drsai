#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load nvm if available (needed in non-interactive shells)
if [ -z "$(which node 2>/dev/null)" ]; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
fi

# Check node
if ! command -v node &>/dev/null; then
    echo "Error: node is not installed. Please install Node.js >= 18."
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    echo "  nvm install 22"
    exit 1
fi

# Check yarn, install if missing
if ! command -v yarn &>/dev/null; then
    echo "yarn not found, installing via npm..."
    npm install -g yarn
fi

# Check gatsby-cli, install if missing globally
if ! command -v gatsby &>/dev/null && [ ! -f "node_modules/.bin/gatsby" ]; then
    echo "gatsby-cli not found globally, will use local after yarn install."
fi

# Install dependencies if node_modules is missing or empty
if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
    echo "Installing dependencies..."
    yarn install --legacy-peer-deps
fi

# Create .env.development from example if it doesn't exist
if [ ! -f ".env.development" ]; then
    if [ -f ".env.example" ]; then
        echo "Creating .env.development from .env.example..."
        cp .env.example .env.development
    else
        echo "Warning: .env.development not found and no .env.example to copy from."
    fi
fi

echo "Starting frontend development server..."
yarn develop
