import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import InvoiceListPage from './pages/InvoiceListPage';
import SupplierListPage from './pages/SupplierListPage';
import RemindersPage from './pages/RemindersPage';
import UploadPage from './pages/UploadPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="invoices" element={<UploadPage />} />
        <Route path="invoice-list" element={<InvoiceListPage />} />
        <Route path="suppliers" element={<SupplierListPage />} />
        <Route path="reminders" element={<RemindersPage />} />
      </Route>
    </Routes>
  );
}
