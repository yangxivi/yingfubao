import { useState, useEffect } from 'react';
import { Modal, Tabs, Form, Input, Button, message } from 'antd';
import { electronAPI } from '../lib/desktop-env';
import { getCurrentUser, clearSession, hashPassword } from '../lib/auth';

export default function UserProfileModal({
  open,
  tab,
  onClose,
  onSuccess,
}: {
  open: boolean;
  tab: 'username' | 'password';
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(tab);

  useEffect(() => {
    setActiveTab(tab);
    form.resetFields();
  }, [tab, open, form]);

  const handleUpdateUsername = async (values: any) => {
    const api = electronAPI();
    const current = getCurrentUser();
    if (!api || !current?.id) return;
    setLoading(true);
    try {
      await api.userUpdate({
        id: current.id,
        username: values.username,
        company_name: values.company_name,
      });
      // 同步更新本地会话显示
      const updated = {
        ...current,
        username: values.username,
        company_name: values.company_name,
      };
      localStorage.setItem('user', JSON.stringify(updated));
      message.success('用户名已更新');
      onSuccess();
    } catch (err: any) {
      message.error(err?.message || '更新失败');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (values: any) => {
    const api = electronAPI();
    const current = getCurrentUser();
    if (!api || !current?.id) return;
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    try {
      // 先验证旧密码（主进程负责 PBKDF2 比对）
      await api.userVerify({
        username: current.username,
        password: values.oldPassword || '',
      });
      await api.userChangePassword({
        id: current.id,
        password_hash: await hashPassword(values.newPassword),
      });
      message.success('密码已修改，请重新登录');
      clearSession();
      onClose();
      window.location.href = '#/login';
    } catch (err: any) {
      message.error(err?.message || '密码修改失败');
    } finally {
      setLoading(false);
    }
  };

  const current = getCurrentUser();

  return (
    <Modal title="账号设置" open={open} onCancel={onClose} footer={null} destroyOnClose>
      <Tabs
        activeKey={activeTab}
        onChange={(k: string) => {
          setActiveTab(k as 'username' | 'password');
          form.resetFields();
        }}
        items={[
          {
            key: 'username',
            label: '修改用户名',
            children: (
              <Form
                form={form}
                onFinish={handleUpdateUsername}
                layout="vertical"
                initialValues={{
                  username: current?.username || '',
                  company_name: current?.company_name || '',
                }}
              >
                <Form.Item
                  name="username"
                  label="用户名"
                  rules={[{ required: true, message: '请输入用户名' }]}
                >
                  <Input placeholder="用户名" />
                </Form.Item>
                <Form.Item name="company_name" label="公司名称">
                  <Input placeholder="公司名称（选填）" />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={loading} block>
                    保存
                  </Button>
                </Form.Item>
              </Form>
            ),
          },
          {
            key: 'password',
            label: '修改密码',
            children: (
              <Form form={form} onFinish={handleChangePassword} layout="vertical">
                <Form.Item
                  name="oldPassword"
                  label="当前密码"
                  rules={[{ required: true, message: '请输入当前密码' }]}
                >
                  <Input.Password placeholder="当前密码" />
                </Form.Item>
                <Form.Item
                  name="newPassword"
                  label="新密码"
                  rules={[
                    { required: true, message: '请输入新密码' },
                    { min: 4, message: '至少4位' },
                  ]}
                >
                  <Input.Password placeholder="新密码" />
                </Form.Item>
                <Form.Item
                  name="confirmPassword"
                  label="确认新密码"
                  rules={[{ required: true, message: '请再次输入新密码' }]}
                >
                  <Input.Password placeholder="确认新密码" />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={loading} block>
                    修改密码
                  </Button>
                </Form.Item>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}
