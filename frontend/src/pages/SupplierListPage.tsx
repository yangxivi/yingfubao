import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Space, message, Popconfirm, Card, Tag,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { supplierApi } from '../api/client';

export default function SupplierListPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<any>(null);
  const [form] = Form.useForm();

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await supplierApi.list({ search });
      setSuppliers(res.data);
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
      message.error(err.response?.data?.detail || '更���失败');
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

  const columns = [
    { title: '供应商名称', dataIndex: 'name', key: 'name', width: 200, ellipsis: true },
    { title: '税号', dataIndex: 'tax_id', key: 'tax_id', width: 180, ellipsis: true },
    { title: '联系人', dataIndex: 'contact_person', key: 'contact', width: 80 },
    { title: '电话', dataIndex: 'phone', key: 'phone', width: 130 },
    { title: '地址', dataIndex: 'address', key: 'address', width: 220, ellipsis: true },
    {
      title: '发票数', dataIndex: 'invoice_count', key: 'count', width: 80,
      render: (v: number) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '累计金额', dataIndex: 'total_amount', key: 'total', width: 140,
      render: (v: number) => <b>��{v.toLocaleString()}</b>,
    },
    {
      title: '操作', key: 'action', width: 160,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>供应商管理</h2>
        <Space>
          <Input.Search placeholder="搜索供应商" onSearch={(v) => { setSearch(v); fetchSuppliers(); }} style={{ width: 250 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增供应商</Button>
        </Space>
      </div>

      <Card>
        <Table
          dataSource={suppliers}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="middle"
          pagination={{ showTotal: (total) => `共 ${total} 家` }}
        />
      </Card>

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
          <Form.Item label="联系人" name="contact_person"><Input /></Form.Item>
          <Form.Item label="电话" name="phone"><Input /></Form.Item>
          <Form.Item label="地址" name="address"><Input /></Form.Item>
          <Form.Item label="开户银行" name="bank_name"><Input /></Form.Item>
          <Form.Item label="银行账号" name="bank_account"><Input /></Form.Item>
          <Form.Item label="备注" name="notes"><Input.TextArea rows={2} /></Form.Item>
          <Button type="primary" htmlType="submit" block>
            {editingSupplier ? '保存修改' : '添加供应商'}
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
