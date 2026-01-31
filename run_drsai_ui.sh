#!/bin/bash

# 检查根目录下是否存在.env文件
if [ ! -f ".env" ]; then
    echo "错误: .env文件不存在，请先创建.env文件"
    exit 1
fi

# 检查frontend目录下是否存在.env.development文件
if [ ! -f "./frontend/.env.development" ]; then
    echo "错误: frontend/.env.development文件不存在，请先创建该文件"
    exit 1
fi

source ~/.bashrc

conda activate drsai

pm2 start -n drsai_backend "drsai ui"

cd ./frontend
pm2 start -n drsai_frontend "yarn run dev "

