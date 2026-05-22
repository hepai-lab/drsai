import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Switch, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { appContext } from "../hooks/provider";
import { ManagedUser, userAPI } from "../components/views/api";

type Row = ManagedUser & { key: string };

const UserManagementPage: React.FC = () => {
  const { user } = useContext(appContext);
  const operatorUserId = user?.email || "";
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [tableScrollY, setTableScrollY] = useState<number>();
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [msgApi, holder] = message.useMessage();

  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const TABLE_CHROME = 112;

    const update = () => {
      const next = el.clientHeight - TABLE_CHROME;
      setTableScrollY(next > 120 ? next : undefined);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    if (!operatorUserId) {
      msgApi.error("未登录或缺少用户信息");
      return;
    }
    setLoading(true);
    try {
      const list = await userAPI.listUsers(operatorUserId);
      setRows(list.map((u) => ({ ...u, key: u.user_id })));
    } catch (e: any) {
      msgApi.error(e?.message || "加载用户失败（可能你还不是管理员）");
    } finally {
      setLoading(false);
    }
  }, [operatorUserId, msgApi]);

  useEffect(() => {
    if (!operatorUserId) return;
    void load();
  }, [operatorUserId, load]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((r) => r.user_id.toLowerCase().includes(qq));
  }, [q, rows]);

  const columns: ColumnsType<Row> = [
    {
      title: "用户",
      dataIndex: "user_id",
      key: "user_id",
      render: (v: string) => <span className="font-mono text-xs">{v}</span>,
    },
    {
      title: "来源",
      dataIndex: "auth_source",
      key: "auth_source",
      width: 120,
      render: (v: Row["auth_source"]) =>
        v === "sso" ? <Tag color="purple">SSO</Tag> : <Tag color="blue">LOCAL</Tag>,
    },
    {
      title: "管理员",
      dataIndex: "is_admin",
      key: "is_admin",
      width: 120,
      render: (_: boolean, record) => (
        <Switch
          checked={record.is_admin}
          onChange={async (next) => {
            if (!operatorUserId) return;
            const prev = record.is_admin;
            setRows((old) =>
              old.map((r) => (r.user_id === record.user_id ? { ...r, is_admin: next } : r))
            );
            try {
              await userAPI.setAdmin(operatorUserId, record.user_id, next);
              msgApi.success(next ? "已设为管理员" : "已取消管理员");
            } catch (e: any) {
              setRows((old) =>
                old.map((r) => (r.user_id === record.user_id ? { ...r, is_admin: prev } : r))
              );
              msgApi.error(e?.message || "更新失败");
            }
          }}
        />
      ),
    },
  ];

  return (
    <div className="h-full min-h-0 flex flex-col p-4">
      {holder}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-base font-semibold text-primary">用户管理</div>

        </div>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="按 user_id 搜索"
            allowClear
            style={{ width: 220 }}
          />
          <Button onClick={() => void load()} loading={loading} type="primary">
            刷新
          </Button>
        </div>
      </div>

      <div ref={tableWrapRef} className="flex-1 min-h-0 h-full">
        <Table<Row>
          size="middle"
          bordered
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={tableScrollY ? { y: tableScrollY } : undefined}
        />
      </div>
    </div>
  );
};

export default UserManagementPage;
