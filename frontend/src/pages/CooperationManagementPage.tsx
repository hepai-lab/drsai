import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button, Form, Input, Modal, Select, Table, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { appContext } from "../hooks/provider";
import { organizationsAPI } from "../components/views/api";

const CooperationManagementPage: React.FC = () => {
  const { user } = useContext(appContext);
  const uid = user?.email || "";
  const [msgApi, holder] = message.useMessage();
  const [access, setAccess] = useState<{ is_platform_admin: boolean; org: any } | null>(null);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [orgAgents, setOrgAgents] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [memberForm] = Form.useForm();
  const [agentForm] = Form.useForm();

  const loadAccess = useCallback(async () => {
    if (!uid) return;
    try {
      const a = await organizationsAPI.getAccess(uid);
      setAccess(a);
    } catch {
      setAccess({ is_platform_admin: false, org: null });
    }
  }, [uid]);

  const loadOrgs = useCallback(async () => {
    if (!uid || !access?.is_platform_admin) return;
    setLoading(true);
    try {
      const list = await organizationsAPI.listOrgs(uid);
      setOrgs(list);
      setSelectedOrgId((prev) => (prev == null && list.length ? list[0].id : prev));
    } catch (e: any) {
      msgApi.error(e?.message || "加载合作组失败");
    } finally {
      setLoading(false);
    }
  }, [uid, access?.is_platform_admin, msgApi]);

  const loadDetail = useCallback(async () => {
    if (!uid || !selectedOrgId || !access) return;
    const can =
      access.is_platform_admin ||
      (access.org?.org_id === selectedOrgId && access.org?.is_org_admin);
    if (!can) return;
    setLoading(true);
    try {
      const [m, a] = await Promise.all([
        organizationsAPI.listMembers(uid, selectedOrgId),
        organizationsAPI.listOrgAgents(selectedOrgId),
      ]);
      setMembers(m);
      setOrgAgents(a);
    } catch (e: any) {
      msgApi.error(e?.message || "加载详情失败");
    } finally {
      setLoading(false);
    }
  }, [uid, selectedOrgId, access, msgApi]);

  const loadPending = useCallback(async () => {
    if (!uid || !access?.is_platform_admin) return;
    try {
      const p = await organizationsAPI.plazaPending(uid);
      setPending(p);
    } catch {
      setPending([]);
    }
  }, [uid, access?.is_platform_admin]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    if (access?.is_platform_admin) void loadOrgs();
  }, [access?.is_platform_admin, loadOrgs]);

  useEffect(() => {
    if (access?.org?.is_org_admin && !access?.is_platform_admin && access.org.org_id) {
      setSelectedOrgId(access.org.org_id);
    }
  }, [access]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const orgOptions = useMemo(
    () => orgs.map((o) => ({ label: `${o.display_name || o.slug} (${o.slug})`, value: o.id })),
    [orgs]
  );

  const onCreateOrg = async () => {
    try {
      const v = await createForm.validateFields();
      await organizationsAPI.createOrg(uid, {
        slug: String(v.slug).trim().toLowerCase(),
        display_name: v.display_name || "",
      });
      msgApi.success("已创建合作组");
      setCreateOpen(false);
      createForm.resetFields();
      await loadOrgs();
    } catch (e: any) {
      if (e?.errorFields) return;
      msgApi.error(e?.message || "创建失败");
    }
  };

  const onAddMember = async () => {
    if (!selectedOrgId) return;
    try {
      const v = await memberForm.validateFields();
      await organizationsAPI.addMember(uid, selectedOrgId, v.user_id.trim(), v.role || "member");
      msgApi.success("已添加成员");
      setMemberOpen(false);
      memberForm.resetFields();
      await loadDetail();
    } catch (e: any) {
      if (e?.errorFields) return;
      msgApi.error(e?.message || "添加失败");
    }
  };

  const onSaveOrgAgent = async () => {
    if (!selectedOrgId) return;
    try {
      const v = await agentForm.validateFields();
      const raw = v.snapshot_json.trim();
      let snapshot: Record<string, unknown>;
      try {
        snapshot = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        msgApi.error("snapshot 需为合法 JSON");
        return;
      }
      const agentId = String(v.agent_id || snapshot.id || "").trim();
      if (!agentId) {
        msgApi.error("请填写 agent_id 或在 JSON 内提供 id");
        return;
      }
      snapshot.id = agentId;
      await organizationsAPI.upsertOrgAgent(uid, selectedOrgId, agentId, snapshot);
      msgApi.success("已保存组内智能体");
      setAgentOpen(false);
      agentForm.resetFields();
      await loadDetail();
    } catch (e: any) {
      if (e?.errorFields) return;
      msgApi.error(e?.message || "保存失败");
    }
  };

  const orgColumns: ColumnsType<any> = [
    { title: "ID", dataIndex: "id", width: 72 },
    { title: "标识", dataIndex: "slug", render: (s: string) => <span className="font-mono text-xs">{s}</span> },
    { title: "名称", dataIndex: "display_name" },
    {
      title: "默认智能体",
      dataIndex: "default_agent_id",
      render: (x: string) => <span className="font-mono text-xs">{x || "-"}</span>,
    },
    {
      title: "操作",
      key: "act",
      width: 100,
      render: (_, r) => (
        <Button
          type="link"
          danger
          size="small"
          onClick={async () => {
            Modal.confirm({
              title: "删除合作组？",
              content: "将级联删除成员与组内智能体配置。",
              onOk: async () => {
                await organizationsAPI.deleteOrg(uid, r.id);
                msgApi.success("已删除");
                if (selectedOrgId === r.id) setSelectedOrgId(null);
                await loadOrgs();
              },
            });
          }}
        >
          删除
        </Button>
      ),
    },
  ];

  const memberColumns: ColumnsType<any> = [
    {
      title: "用户",
      dataIndex: "user_id",
      render: (x: string) => <span className="font-mono text-xs">{x}</span>,
    },
    { title: "角色", dataIndex: "role", width: 120, render: (r: string) => <Tag>{r}</Tag> },
    {
      title: "操作",
      key: "rm",
      width: 100,
      render: (_, r) => (
        <Button
          type="link"
          danger
          size="small"
          onClick={async () => {
            if (!selectedOrgId) return;
            await organizationsAPI.removeMember(uid, selectedOrgId, r.user_id);
            msgApi.success("已移除");
            await loadDetail();
          }}
        >
          移除
        </Button>
      ),
    },
  ];

  const agentColumns: ColumnsType<any> = [
    {
      title: "agent_id",
      dataIndex: "agent_id",
      render: (x: string) => <span className="font-mono text-xs">{x}</span>,
    },
    {
      title: "名称",
      render: (_, r) => (r.snapshot?.name as string) || "-",
    },
    {
      title: "操作",
      key: "da",
      width: 100,
      render: (_, r) => (
        <Button
          type="link"
          danger
          size="small"
          onClick={async () => {
            if (!selectedOrgId) return;
            await organizationsAPI.deleteOrgAgent(uid, selectedOrgId, r.agent_id);
            msgApi.success("已删除");
            await loadDetail();
          }}
        >
          删除
        </Button>
      ),
    },
  ];

  const pendingColumns: ColumnsType<any> = [
    {
      title: "申请人",
      dataIndex: "applicant_user_id",
      render: (x: string) => <span className="font-mono text-xs">{x}</span>,
    },
    { title: "目标组", dataIndex: "target_org_id", width: 88 },
    {
      title: "智能体",
      dataIndex: "requested_agent_id",
      render: (x: string) => <span className="font-mono text-xs">{x}</span>,
    },
    {
      title: "操作",
      key: "ap",
      width: 160,
      render: (_, r) => (
        <div className="flex gap-1">
          <Button
            type="primary"
            size="small"
            onClick={async () => {
              await organizationsAPI.plazaApprove(uid, r.uuid);
              msgApi.success("已通过");
              await loadPending();
            }}
          >
            通过
          </Button>
          <Button
            size="small"
            onClick={async () => {
              await organizationsAPI.plazaReject(uid, r.uuid);
              msgApi.info("已驳回");
              await loadPending();
            }}
          >
            驳回
          </Button>
        </div>
      ),
    },
  ];

  const canManageSelected =
    access?.is_platform_admin ||
    (access?.org?.org_id === selectedOrgId && access?.org?.is_org_admin);

  return (
    <div className="h-full min-h-0 flex flex-col p-4 overflow-auto">
      {holder}
      <div className="text-base font-semibold text-primary mb-1">合作组管理</div>
      <div className="text-xs text-secondary mb-4">
        平台管理员可创建合作组、审批广场跨组申请；组管理员可维护本组成员与组内智能体白名单。
      </div>

      <Tabs
        items={[
          {
            key: "mine",
            label: "我的合作组",
            children: (
              <div className="max-w-xl text-sm">
                {access == null ? (
                  <span className="text-secondary">加载中…</span>
                ) : (
                  <pre className="bg-tertiary/30 rounded-lg p-3 text-xs overflow-auto">
                    {JSON.stringify(
                      access.org
                        ? { ...access.org, is_platform_admin: access.is_platform_admin }
                        : { message: "未加入合作组", is_platform_admin: access.is_platform_admin },
                      null,
                      2
                    )}
                  </pre>
                )}
              </div>
            ),
          },
          ...(access?.is_platform_admin
            ? [
                {
                  key: "orgs",
                  label: "全部合作组",
                  children: (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <Button type="primary" onClick={() => setCreateOpen(true)}>
                          新建合作组
                        </Button>
                        <Select
                          className="min-w-[220px]"
                          placeholder="选择要编辑的合作组"
                          options={orgOptions}
                          value={selectedOrgId ?? undefined}
                          onChange={(v) => setSelectedOrgId(v)}
                          allowClear
                        />
                      </div>
                      <Table
                        size="small"
                        rowKey="id"
                        loading={loading}
                        columns={orgColumns}
                        dataSource={orgs}
                        pagination={false}
                      />
                    </div>
                  ),
                },
                {
                  key: "pending",
                  label: "广场申请",
                  children: (
                    <Table
                      size="small"
                      rowKey="uuid"
                      columns={pendingColumns}
                      dataSource={pending}
                      pagination={false}
                    />
                  ),
                },
              ]
            : []),
          ...(canManageSelected && selectedOrgId
            ? [
                {
                  key: "detail",
                  label: "成员与组内智能体",
                  children: (
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <Button onClick={() => setMemberOpen(true)}>添加成员</Button>
                        <Button onClick={() => setAgentOpen(true)}>添加组内智能体</Button>
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-2">成员</div>
                        <Table
                          size="small"
                          rowKey={(r) => `${r.user_id}-${r.org_id}`}
                          columns={memberColumns}
                          dataSource={members}
                          pagination={false}
                        />
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-2">组内智能体（白名单）</div>
                        <Table
                          size="small"
                          rowKey="agent_id"
                          columns={agentColumns}
                          dataSource={orgAgents}
                          pagination={false}
                        />
                      </div>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal title="新建合作组" open={createOpen} onOk={onCreateOrg} onCancel={() => setCreateOpen(false)}>
        <Form form={createForm} layout="vertical">
          <Form.Item name="slug" label="标识 slug" rules={[{ required: true, message: "必填" }]}>
            <Input placeholder="例如 drsai" />
          </Form.Item>
          <Form.Item name="display_name" label="显示名称">
            <Input placeholder="显示名称" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="添加成员" open={memberOpen} onOk={onAddMember} onCancel={() => setMemberOpen(false)}>
        <Form form={memberForm} layout="vertical">
          <Form.Item name="user_id" label="用户邮箱 user_id" rules={[{ required: true }]}>
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="member">
            <Select
              options={[
                { value: "member", label: "member" },
                { value: "org_admin", label: "org_admin" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="添加组内智能体"
        open={agentOpen}
        onOk={onSaveOrgAgent}
        onCancel={() => setAgentOpen(false)}
        width={640}
      >
        <Form form={agentForm} layout="vertical">
          <Form.Item
            name="agent_id"
            label="agent_id（可与 JSON 内 id 一致）"
            rules={[{ required: false }]}
          >
            <Input placeholder="UUID 或唯一 id" />
          </Form.Item>
          <Form.Item
            name="snapshot_json"
            label="snapshot（完整智能体 JSON，与侧边栏条目一致）"
            rules={[{ required: true, message: "必填" }]}
          >
            <Input.TextArea rows={10} placeholder='{"id":"...","mode":"magentic-one","name":"..."}' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CooperationManagementPage;
