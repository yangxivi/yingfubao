import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Space, message, Popconfirm, Card,
  Select, Statistic, Tag, Row, Col,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  TeamOutlined, UserOutlined, PhoneOutlined, EnvironmentOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import { supplierApi } from '../api/client';

export default function SupplierListPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any>(null);
  const [form] = Form.useForm();

  // 高级筛选
  const [hasContactFilter, setHasContactFilter] = useState<string>('');

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await supplierApi.list({ search });
      let list = res.data;
      // 客户端筛选：有/无联系人
      if (hasContactFilter === 'yes') list = list.filter((s: any) => s.contact_person);
      if (hasContactFilter === 'no') list = list.filter((s: any) => !s.contact_person);
      setSuppliers(list);
    } catch (err) { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchSuppliers(); }, []);

  const handleCreate = async (values: any) => {
    try {
      await supplierApi.create(values);
      message.success('供应商已添加');
      setModalOpen(false);
      form.resetFields();
      fetchSuppliers();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '添加失败');
    }
  };

  const handleUpdate = async (values: any) => {
    if (!editingSupplier) return;
    try {
      await supplierApi.update(editingSupplier.id, values);
      message.success('已更新');
      setModalOpen(false);
      setEditingSupplier(null);
      form.resetFields();
      fetchSuppliers();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '更新失败');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await supplierApi.delete(id);
      message.success('已删除');
      fetchSuppliers();
    } catch (err: any) {
      message.error(err.response?.data?.detail || '删除失败');
    }
  };

  const openCreate = () => {
    setEditingSupplier(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: any) => {
    setEditingSupplier(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  // 汇总统计
  const summary = {
    total: suppliers.length,
    hasContact: suppliers.filter((s) => s.contact_person).length,
    noContact: suppliers.filter((s) => !s.contact_person).length,
  };

  const columns = [
    {
      title: '公司名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (v: string) => (
        <span style={{ color: '#1677ff', fontWeight: 500 }}>
          <TeamOutlined style={{ marginRight: 6 }} />
          {v}
        </span>
      ),
    },
    {
      title: '统一社会信用代码',
      dataIndex: 'tax_id',
      key: 'tax_id',
      width: 190,
      ellipsis: true,
    },
    {
      title: '地址',
      dataIndex: 'address',
      key: 'address',
      width: 200,
      ellipsis: true,
      render: (v: string) => v ? (
        <span><EnvironmentOutlined style={{ marginRight: 4, color: '#999' }} />{v}</span>
      ) : <span style={{ color: '#d9d9d9' }}>—</span>,
    },
    {
      title: '联系人电话',
      key: 'contact_phone',
      width: 140,
      render: (_: any, r: any) => (
        <span>
          {r.phone ? <><PhoneOutlined style={{ marginRight: 4, color: '#999' }} />{r.phone}</> : <span style={{ color: '#d9d9d9' }}>—</span>}
          {r.contact_person && !r.phone && <><UserOutlined style={{ marginRight: 4, color: '#999' }} />{r.contact_person}</>}
        </span>
      ),
    },
    {
      title: '联系人',
      dataIndex: 'contact_person',
      key: 'contact',
      width: 90,
      render: (v: string) => v ? (
        <span><UserOutlined style={{ marginRight: 4, color: '#999' }} />{v}</span>
      ) : <Tag color="default" style={{ fontSize: 12 }}>无联系人</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'time',
      width: 110,
      render: (v: string) => v ? v.slice(0, 10) : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: any) => (
        <Space size={2}>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 页面标题 */}
      <div className="yb-page-header">
        <h2>供应商管理</h2>
        <p>管理所有供应商信息</p>
      </div>

      {/* 工具栏 */}
      <div className="yb-toolbar">
        <div className="yb-toolbar-left">
          <Input.Search
            placeholder="搜索公司名称、统一社会信用代码或联系人..."
            onSearch={(v) => { setSearch(v); setTimeout(fetchSuppliers, 50); }}
            style={{ width: 320 }}
            allowClear
          />
          <Select
            placeholder="全部供应商"
            allowClear
            style={{ width: 140 }}
            value={hasContactFilter || undefined}
            onChange={(v) => { setHasContactFilter(v || ''); setTimeout(fetchSuppliers, 50); }}
          >
            <Select.Option value="yes">有联系人</Select.Option>
            <Select.Option value="no">无联系人</Select.Option>
          </Select>
          <Select placeholder="高级筛选" allowClear style={{ width: 120 }} dropdownRender={() => null}>
            <Select.Option value="">高级筛选</Select.Option>
          </Select>
        </div>
        <div className="yb-toolbar-right">
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加供应商
          </Button>
        </div>
      </div>

      {/* 表格 + 底部汇总 */}
      <Card bodyStyle={{ padding: 0 }}>
        <Table
          dataSource={suppliers}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          pagination={{ showTotal: (total) => `共 ${total} 家` }}
          scroll={{ x: 1000 }}
        />

        {/* 底部汇总栏 */}
        <div className="yb-summary-bar">
          <div className="yb-summary-item">
            <div className="summary-label">供应商总数</div>
            <div className="summary-value">{summary.total}</div>
          </div>
          <div className="yb-summary-item summary-success">
            <div className="summary-label">有联系人</div>
            <div className="summary-value">{summary.hasContact}</div>
          </div>
          <div className="yb-summary-item" style={{ color: '#999' }}>
            <div className="summary-label">无联系人</div>
            <div className="summary-value">{summary.noContact}</div>
          </div>
        </div>
      </Card>

      {/* 新建/编辑弹窗 */}
      <Modal
        title={editingSupplier ? '编辑供应商' : '新增供应商'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditingSupplier(null); }}
        footer={null}
        width={640}
      >
        <Form form={form} layout="vertical" onFinish={editingSupplier ? handleUpdate : handleCreate}>
          <Form.Item label="供应商名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如: 西安金晟达汽车零部件有限公司" />
          </Form.Item>
          <Form.Item label="统一社会信用代码/税号" name="tax_id">
            <Input placeholder="18位社会信用代码" maxLength={18} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="联系人" name="contact_person"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="电话" name="phone"><Input /></Form.Item>
            </Col>
          </Row>
          <Form.Item label="地址" name="address"><Input /></Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="开户银行" name="bank_name"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="银行账号" name="bank_account"><Input /></Form.Item>
            </Col>
          </Row>
          <Form.Item label="备注" name="notes"><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" block>
            {editingSupplier ? '保存修改' : '添加供应商'}
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
