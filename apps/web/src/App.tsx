import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading, Notice } from './components/ui';
import { LoginPage, AccountPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { ApprovalsPage } from './pages/Approvals';
import { PupilsPage, PupilFormPage, PupilDetailPage } from './pages/Pupils';
import { FeesPage } from './pages/Fees';
import { ChargesPage, ChargeDetailPage } from './pages/Charges';
import { BillingPage } from './pages/Billing';
import { PaymentsPage, NewPaymentPage, ReceiptPage } from './pages/Payments';
import { ArrearsPage, StatementPage } from './pages/Collections';
import { ExpensesPage, ExpenseDetailPage } from './pages/Expenses';
import { OwnerFundsPage } from './pages/OwnerFunds';
import { PayrollPage, PayrollRunPage, PayslipPage } from './pages/Payroll';
import { CarryForwardPage } from './pages/CarryForward';
import { TermClosePage, SnapshotPage } from './pages/TermClose';
import { ReportsPage } from './pages/Reports';
import { SetupPage } from './pages/Setup';
import { UsersPage, AuditPage } from './pages/Admin';

function Guard({ perm, children }: { perm: string | string[]; children: ReactElement }) {
  const { can } = useAuth();
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!perms.some(can)) return <Notice tone="warning" title="Not available">Your role does not include access to this page. Ask an administrator if you need it.</Notice>;
  return children;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <DashboardPage />;
  if (can('pupils.view')) return <Navigate to="/pupils" replace />;
  return <Notice>Welcome. Your role has no pages yet; ask an administrator to assign one.</Notice>;
}

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <div className="p-8"><Loading /></div>;
  if (!me) return <LoginPage />;
  if (me.mustChangePassword) return <div className="mx-auto max-w-lg p-6"><AccountPage forced /></div>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="approvals" element={<Guard perm="approvals.view"><ApprovalsPage /></Guard>} />
        <Route path="pupils" element={<Guard perm="pupils.view"><PupilsPage /></Guard>} />
        <Route path="pupils/new" element={<Guard perm="pupils.manage"><PupilFormPage /></Guard>} />
        <Route path="pupils/:id" element={<Guard perm="pupils.view"><PupilDetailPage /></Guard>} />
        <Route path="pupils/:id/edit" element={<Guard perm="pupils.manage"><PupilFormPage /></Guard>} />
        <Route path="fees" element={<Guard perm="fees.view"><FeesPage /></Guard>} />
        <Route path="charges" element={<Guard perm="charges.view"><ChargesPage /></Guard>} />
        <Route path="charges/:id" element={<Guard perm="charges.view"><ChargeDetailPage /></Guard>} />
        <Route path="billing" element={<Guard perm="billing.run"><BillingPage /></Guard>} />
        <Route path="payments" element={<Guard perm="payments.view"><PaymentsPage /></Guard>} />
        <Route path="payments/new" element={<Guard perm="payments.record"><NewPaymentPage /></Guard>} />
        <Route path="receipts/:receiptNo" element={<Guard perm="payments.view"><ReceiptPage /></Guard>} />
        <Route path="arrears" element={<Guard perm="arrears.view"><ArrearsPage /></Guard>} />
        <Route path="statements" element={<Guard perm="statements.view"><StatementPage /></Guard>} />
        <Route path="statements/:pupilId" element={<Guard perm="statements.view"><StatementPage /></Guard>} />
        <Route path="expenses" element={<Guard perm="expenses.view"><ExpensesPage /></Guard>} />
        <Route path="expenses/:id" element={<Guard perm="expenses.view"><ExpenseDetailPage /></Guard>} />
        <Route path="owner-funds" element={<Guard perm="owner.view"><OwnerFundsPage /></Guard>} />
        <Route path="payroll" element={<Guard perm="payroll.view"><PayrollPage /></Guard>} />
        <Route path="payroll/runs/:id" element={<Guard perm="payroll.view"><PayrollRunPage /></Guard>} />
        <Route path="payroll/runs/:id/payslips/:staffId" element={<Guard perm="payroll.view"><PayslipPage /></Guard>} />
        <Route path="carry-forward" element={<Guard perm="carryforward.run"><CarryForwardPage /></Guard>} />
        <Route path="term-close" element={<Guard perm={['snapshots.view', 'termclose.prepare', 'termclose.approve']}><TermClosePage /></Guard>} />
        <Route path="term-close/snapshots/:id" element={<Guard perm={['snapshots.view', 'termclose.prepare', 'termclose.approve']}><SnapshotPage /></Guard>} />
        <Route path="reports" element={<Guard perm="reports.view"><ReportsPage /></Guard>} />
        <Route path="setup" element={<Guard perm="setup.view"><SetupPage /></Guard>} />
        <Route path="users" element={<Guard perm="users.manage"><UsersPage /></Guard>} />
        <Route path="audit" element={<Guard perm="audit.view"><AuditPage /></Guard>} />
        <Route path="account" element={<AccountPage />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Notice tone="warning" title="Page not found">That page does not exist.</Notice>} />
      </Route>
    </Routes>
  );
}
