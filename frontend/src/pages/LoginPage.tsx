import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message, Tabs, Alert, Space, Tag } from 'antd';
import { UserOutlined, LockOutlined, BankOutlined, CloudOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { authApi } from '../api/client';
import { getAuthMode, hasLocalUsers } from '../lib/auth';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const isLocalMode = getAuthMode() === 'local';
  const noLocalUsers = isLocalMode && !hasLocalUsers();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const endpoint = values.tab === 'register' ? authApi.register : authApi.login;
      const res = await endpoint({
        username: values.username,
        password: values.password,
        ...(values.tab === 'register' ? { company_name: values.company_name || '' } : {}),
      });
      localStorage.setItem('token', res.data.access_token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      message.success(values.tab === 'register' ? '注册成功' : '登录成功');
      navigate('/');
    } catch (err: any) {
      // 兼容直接 throw Error 和 axios 响应两种格式
      const msg = err?.message || err?.response?.data?.detail || err?.response?.data?.message || '操作失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>💰 应付宝</h1>
        <p className="subtitle">应付账款管理系统</p>

        {/* 本地模式 + 无本地账号 → 显示引导 */}
        {noLocalUsers && (
          <Alert
            type="warning"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 20 }}
            message={
              <Space direction="vertical" size={4}>
                <span>
                  <Tag color="orange" style={{ marginRight: 6 }}>本地模式</Tag>
                  云端数据库未初始化，当前数据仅存储在本浏览器。
                </span>
                <span style={{ fontSize: 12, opacity: 0.8 }}>
                  如需跨浏览器访问，请在<strong>已登录的原浏览器</strong>中完成云端同步设置（顶栏点击「本地模式」标识）。
                  或在此注册新账号（数据仅本浏览器可用）。
                </span>
              </Space>
            }
          />
        )}

        {/* 本地模式但有本地账号 → 轻量提示 */}
        {isLocalMode && !noLocalUsers && (
          <Alert
            type="info"
            showIcon
            icon={<CloudOutlined />}
            style={{ marginBottom: 16, padding: '8px 14px' }}
            message={
              <span style={{ fontSize: 12 }}>
                当前为<Tag>本地模式</Tag>，数据仅本浏览器可用。登录后可在顶栏开启云端同步。
              </span>
            }
          />
        )}

        <Tabs
          centered
          defaultActiveKey="login"
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form name="login" onFinish={(v) => onFinish({ ...v, tab: 'login' })} size="large">
                  <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                    <Input prefix={<UserOutlined />} placeholder="用户名" />
                  </Form.Item>
                  <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                  </Form.Item>
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading} block>
                      登录
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form name="register" onFinish={(v) => onFinish({ ...v, tab: 'register' })} size="large">
                  <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                    <Input prefix={<UserOutlined />} placeholder="用户名" />
                  </Form.Item>
                  <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }, { min: 4, message: '至少4位' }]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                  </Form.Item>
                  <Form.Item name="company_name">
                    <Input prefix={<BankOutlined />} placeholder="公司名称（选填）" />
                  </Form.Item>
                  {noLocalUsers && (
                    <Alert
                      type="info"
                      style={{ marginBottom: 8, padding: '6px 10px', fontSize: 12 }}
                      message="在此注册将创建一个仅本浏览器可用的本地账号，不会与原浏览器数据同步。"
                    />
                  )}
                  <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading} block>
                      注册
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
