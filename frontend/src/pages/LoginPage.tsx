import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message, Tabs } from 'antd';
import { UserOutlined, LockOutlined, BankOutlined } from '@ant-design/icons';
import { authApi } from '../api/client';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
      message.error(err.response?.data?.detail || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>💰 应付宝</h1>
        <p className="subtitle">应付账款管理系统</p>
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
