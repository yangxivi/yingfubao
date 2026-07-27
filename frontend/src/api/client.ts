import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Auto-attach JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

// --- Auth ---
export const authApi = {
  register: (data: { username: string; password: string; company_name?: string; email?: string }) =>
    api.post('/auth/register', data),
  login: (data: { username: string; password: string }) =>
    api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
};

// --- Invoices ---
export const invoiceApi = {
  list: (params?: any) => api.get('/invoices', { params }),
  get: (id: number) => api.get(`/invoices/${id}`),
  create: (data: any) => api.post('/invoices', data),
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/invoices/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  update: (id: number, data: any) => api.put(`/invoices/${id}`, data),
  delete: (id: number) => api.delete(`/invoices/${id}`),
};

// --- Suppliers ---
export const supplierApi = {
  list: (params?: any) => api.get('/suppliers', { params }),
  create: (data: any) => api.post('/suppliers', data),
  update: (id: number, data: any) => api.put(`/suppliers/${id}`, data),
  delete: (id: number) => api.delete(`/suppliers/${id}`),
};

// --- Dashboard & Reminders ---
export const dashboardApi = {
  summary: () => api.get('/dashboard'),
  reminders: () => api.get('/reminders'),
};

export default api;
