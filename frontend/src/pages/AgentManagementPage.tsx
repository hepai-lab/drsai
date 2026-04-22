import { appContext } from "@/hooks/provider";
import { useAgentManager } from "@/components/views/hooks/useAgentManager";
import type { Agent } from "@/types/common";
import { Button, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import React, { useContext, useEffect, useMemo } from "react";

type AgentRow = Agent & { key: string };

const AgentManagementPage: React.FC = () => {
  const { user } = useContext(appContext);
  const userId = user?.email;
  const { agents, fetchAgentList, isLoading } = useAgentManager(userId);

  useEffect(() => {
    if (!userId) return;
    fetchAgentList();
  }, [userId, fetchAgentList]);

  const dataSource: AgentRow[] = useMemo(() => {
    return (agents || [])
      .filter((a) => a && typeof a === "object")
      .map((a) => ({ ...(a as Agent), key: String(a.id || a.mode || a.name) }));
  }, [agents]);

  const columns: ColumnsType<AgentRow> = useMemo(
    () => [
      {
        title: "名称",
        dataIndex: "name",
        key: "name",
        render: (name: string, row: AgentRow) => (
          <div className="flex flex-col">
            <span className="text-primary font-medium">
              {name || row.mode || row.id}
            </span>
            {row.description ? (
              <span className="text-xs text-secondary mt-1 line-clamp-2">
                {row.description}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        title: "模式",
        dataIndex: "mode",
        key: "mode",
        width: 160,
        render: (mode: string) => (
          <span className="text-secondary">{mode || "-"}</span>
        ),
      },
      {
        title: "Owner",
        dataIndex: "owner",
        key: "owner",
        width: 140,
        render: (owner: string) => (
          <span className="text-secondary">{owner || "-"}</span>
        ),
      },
      {
        title: "标签",
        dataIndex: "tags",
        key: "tags",
        width: 220,
        render: (tags: any) => {
          const list = Array.isArray(tags) ? tags : [];
          if (list.length === 0) return <span className="text-secondary">-</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {list.slice(0, 6).map((t) => (
                <Tag key={String(t)}>{String(t)}</Tag>
              ))}
            </div>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="h-full min-h-0 flex flex-col p-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-base font-medium text-primary">智能体管理</div>
          <div className="text-sm text-secondary mt-1">
            在这里查看你的智能体列表。
          </div>
        </div>
        <Button onClick={() => void fetchAgentList()} loading={isLoading}>
          刷新
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <Table<AgentRow>
          size="middle"
          loading={isLoading}
          columns={columns}
          dataSource={dataSource}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ y: "calc(100vh - 260px)" }}
        />
      </div>
    </div>
  );
};

export default AgentManagementPage;
