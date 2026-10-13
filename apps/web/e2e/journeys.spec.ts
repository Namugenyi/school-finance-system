import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * The main journeys of a term, run in order against a fresh database (see playwright.config.ts):
 * register, set fees, bill with a discount, approve, pay, overpay, reverse, spend, close, carry forward.
 * Each role signs in to its own browser context, so permissions are exercised through the real UI.
 */
const PASSWORD = 'Test-pass-2026';
const PUPIL = 'Amina Test Nakato';
const sessions = new Map<string, Page>();

async function as(browser: Browser, username: string): Promise<Page> {
  const existing = sessions.get(username);
  if (existing) return existing;
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /User/ })).toBeVisible();
  sessions.set(username, page);
  return page;
}

test.describe.configure({ mode: 'serial' });

test('a bursar registers a pupil and gets an automatic pupil ID', async ({ browser }) => {
  const page = await as(browser, 'bursar');
  await page.goto('/pupils/new');
  await page.getByLabel('Full name').fill(PUPIL);
  await page.getByLabel('Sex').selectOption({ label: 'Female' });
  await page.getByLabel('Class').selectOption({ label: 'P1 (Primary)' });
  await page.getByLabel('Parent / guardian name').fill('Test Guardian');
  await page.getByLabel("Guardian's relationship to pupil").selectOption({ label: 'Mother' });
  await page.getByLabel('Emergency contact name').fill('Test Aunt');
  await page.getByLabel("Emergency contact's relationship to pupil").selectOption({ label: 'Other' });
  await page.getByLabel("Emergency contact's relationship (please specify)").fill('Neighbour');
  await page.getByLabel('Emergency contact telephone').fill('0782000000');
  await page.getByRole('button', { name: 'Register pupil' }).click();
  await expect(page.getByRole('heading', { name: PUPIL })).toBeVisible();
  await expect(page.getByText('STJA-2026-0001').first()).toBeVisible();
  await expect(page.getByText('Other: Neighbour')).toBeVisible();
});

test('fees are entered for P1 in Term 3', async ({ browser }) => {
  const page = await as(browser, 'bursar');
  await page.goto('/fees');
  await page.getByLabel('Class').selectOption({ label: 'P1 (Primary)' });
  await page.getByRole('button', { name: 'Edit fees' }).click();
  await page.getByLabel('Charge School Fees').check();
  await page.getByLabel('School Fees amount').fill('500,000');
  await page.getByLabel('Charge School Uniform').check();
  await page.getByLabel('School Uniform amount').fill('80000');
  await page.getByRole('button', { name: 'Save fees' }).click();
  await expect(page.getByRole('cell', { name: '500,000.00' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '580,000.00' }).first()).toBeVisible();
});

test('billing previews, takes a discount request and posts once', async ({ browser }) => {
  const page = await as(browser, 'bursar');
  await page.goto('/billing');
  await page.getByLabel('Class').selectOption({ label: 'P1 (Primary)' });
  await page.getByRole('button', { name: 'Preview charges' }).click();
  await expect(page.getByRole('button', { name: 'Post 2 charges' })).toBeVisible();
  await page.getByLabel(`Discount for ${PUPIL}, School Fees`).fill('50000');
  await page.getByLabel(`Discount reason for ${PUPIL}, School Fees`).fill('Sibling discount');
  await page.getByRole('button', { name: 'Post 2 charges' }).click();
  await page.getByRole('button', { name: 'Yes, post 2 charges' }).click();
  await expect(page.getByText('Charges posted')).toBeVisible();

  // Previewing again finds nothing new to charge: the duplicate guard holds.
  await page.getByRole('button', { name: 'Preview charges' }).click();
  await expect(page.getByText('Already charged this term').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post 0 charges' })).toBeDisabled();
});

test('the bursar cannot approve their own discount; the head teacher can', async ({ browser }) => {
  const bursar = await as(browser, 'bursar');
  await bursar.goto('/approvals');
  await expect(bursar.getByText('You entered this, so someone else must approve it.')).toBeVisible();

  const head = await as(browser, 'head');
  await head.goto('/approvals');
  await expect(head.getByText('Discount or waiver')).toBeVisible();
  await head.getByRole('button', { name: 'Approve' }).click();
  await expect(head.getByText('Nothing is waiting for approval')).toBeVisible();
});

test('a payment split across fee items prints a receipt with balances', async ({ browser }) => {
  const page = await as(browser, 'bursar');
  await page.goto('/payments/new?pupilId=1');
  await page.getByLabel('Paying now for School Fees, Term 3 2026').fill('200000');
  await page.getByLabel('Method').selectOption({ label: 'Cash' });
  await page.getByRole('button', { name: /Save and issue receipt/ }).click();
  await expect(page).toHaveURL(/\/receipts\/RCT-2026-00001/);
  await expect(page.getByText('Official receipt')).toBeVisible();
  await expect(page.getByText('UGX 200,000.00')).toBeVisible();
  // 500,000 less the approved 50,000 discount less 200,000 paid.
  await expect(page.getByRole('cell', { name: '250,000.00' })).toBeVisible();
});

test('an overpayment needs confirming, then a reversal needs a second person', async ({ browser }) => {
  const bursar = await as(browser, 'bursar');
  await bursar.goto('/payments/new?pupilId=1');
  await bursar.getByLabel('Paying now for School Uniform, Term 3 2026').fill('100000');
  await bursar.getByLabel('Method').selectOption({ label: 'Cash' });
  await bursar.getByRole('button', { name: /Save and issue receipt/ }).click();
  await expect(bursar.getByText('Record an overpayment?')).toBeVisible();
  await bursar.getByRole('button', { name: 'Yes, record the overpayment' }).click();
  await expect(bursar).toHaveURL(/RCT-2026-00002/);
  await expect(bursar.getByText(/overpaid and now shows a credit/)).toBeVisible();

  await bursar.getByRole('button', { name: 'Request reversal' }).click();
  await bursar.getByLabel('Reason').fill('Parent paid the wrong amount; refunded in cash');
  await bursar.getByRole('button', { name: 'Send for approval' }).click();
  await expect(bursar.getByText('Reversal waiting for approval')).toBeVisible();

  const head = await as(browser, 'head');
  await head.goto('/approvals');
  await head.getByRole('button', { name: 'Approve' }).click();
  await expect(head.getByText('Nothing is waiting for approval')).toBeVisible();
  await head.goto('/receipts/RCT-2026-00002');
  await expect(head.getByText('Reversed', { exact: true })).toBeVisible();
});

test('arrears and the statement agree on what is owed', async ({ browser }) => {
  const page = await as(browser, 'bursar');
  await page.goto('/arrears');
  const row = page.getByRole('row', { name: new RegExp(PUPIL) });
  // School fees 250,000 plus the uniform's 80,000 once the overpayment was reversed.
  await expect(row.getByRole('cell', { name: '330,000.00' })).toBeVisible();
  await row.getByRole('link', { name: PUPIL }).click();
  await expect(page.getByText('Statement of account')).toBeVisible();
  await expect(page.getByText('330,000.00').first()).toBeVisible();
});

test('an expense counts only after someone else approves it', async ({ browser }) => {
  const bursar = await as(browser, 'bursar');
  await bursar.goto('/expenses');
  await bursar.getByRole('button', { name: 'Add expense' }).click();
  const form = bursar.getByRole('dialog');
  await form.getByLabel('Category').selectOption({ label: 'Electricity' });
  await form.getByLabel('Amount (UGX)').fill('120000');
  await form.getByLabel('Description').fill('UMEME prepaid units');
  await form.getByLabel('Paid by').selectOption({ label: 'Cash' });
  await form.getByRole('button', { name: 'Save for approval' }).click();
  await expect(bursar.getByText(/Saved as EXP-\d+, waiting for approval/)).toBeVisible();

  const head = await as(browser, 'head');
  await head.goto('/expenses');
  await head.getByRole('link', { name: /EXP-/ }).first().click();
  await head.getByRole('button', { name: 'Approve' }).click();
  await expect(head.getByText('Approved', { exact: true })).toBeVisible();
});

test('the auditor can read reports but cannot record anything', async ({ browser }) => {
  const page = await as(browser, 'auditor');
  await page.goto('/reports');
  await expect(page.getByRole('row', { name: /Total collected/ }).getByRole('cell', { name: '200,000.00' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Total expenses/ }).getByRole('cell', { name: '120,000.00' })).toBeVisible();
  await page.goto('/payments');
  await expect(page.getByRole('link', { name: 'Record payment' })).toHaveCount(0);
  await page.goto('/billing');
  await expect(page.getByText('Your role does not include access to this page.')).toBeVisible();
});

test('a new dropdown value from Setup shows up straight away', async ({ browser }) => {
  const admin = await as(browser, 'admin');
  await admin.goto('/setup');
  await admin.getByRole('tab', { name: 'Dropdown lists' }).click();
  await admin.getByRole('button', { name: /Expense Category/ }).click();
  await admin.getByLabel('New value').fill('Library Books');
  await admin.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(admin.getByRole('cell', { name: 'Library Books' })).toBeVisible();

  const bursar = await as(browser, 'bursar');
  await bursar.goto('/expenses');
  await bursar.reload();
  await bursar.getByRole('button', { name: 'Add expense' }).click();
  await expect(bursar.getByRole('dialog').getByLabel('Category').locator('option', { hasText: 'Library Books' })).toHaveCount(1);
});

test('closing Term 3 needs the head teacher, and freezes the snapshot', async ({ browser }) => {
  const bursar = await as(browser, 'bursar');
  await bursar.goto('/term-close');
  await expect(bursar.getByText('Nothing is blocking the close.')).toBeVisible();
  await bursar.getByRole('button', { name: 'Prepare close snapshot' }).click();
  await bursar.getByRole('button', { name: 'I have checked the figures, record the snapshot' }).click();
  await expect(bursar.getByRole('link', { name: 'Version 1' })).toBeVisible();

  const head = await as(browser, 'head');
  await head.goto('/term-close');
  await head.getByRole('link', { name: 'Version 1' }).click();
  await head.getByRole('button', { name: 'Approve' }).click();
  await expect(head.getByText(/This snapshot is frozen/)).toBeVisible();
});

test('unpaid balances carry forward into the next year once', async ({ browser }) => {
  const admin = await as(browser, 'admin');
  await admin.goto('/setup');
  await admin.getByRole('tab', { name: 'Years and terms' }).click();
  await admin.getByLabel('Year', { exact: true }).fill('2027');
  await admin.getByRole('button', { name: 'Add year' }).click();
  await admin.getByRole('button', { name: 'Add term' }).click();
  await admin.getByLabel('Start date').fill('01/02/2027');
  await admin.getByLabel('End date').fill('30/04/2027');
  await admin.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByRole('cell', { name: '30/04/2027' })).toBeVisible();

  const bursar = await as(browser, 'bursar');
  await bursar.goto('/carry-forward');
  await bursar.reload();
  await bursar.getByLabel('From term').selectOption({ label: 'Term 3 2026 (closed)' });
  await bursar.getByLabel('To term').selectOption({ label: 'Term 1 2027' });
  await bursar.getByRole('button', { name: 'Preview' }).click();
  await bursar.getByRole('button', { name: 'Carry 2 balances' }).click();
  await bursar.getByRole('button', { name: 'Yes, carry forward' }).click();
  await expect(bursar.getByText('Arrears carried forward')).toBeVisible();

  // Nothing is left to carry a second time.
  await bursar.getByRole('button', { name: 'Preview' }).click();
  await expect(bursar.getByText(/Nothing to carry/)).toBeVisible();

  await bursar.goto('/statements/1');
  await expect(bursar.getByText('from School Fees, Term 3 2026')).toBeVisible();
  await expect(bursar.getByText('330,000.00').first()).toBeVisible();
});

test('a locked-out user asks for help and the administrator sets a temporary password', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Trouble signing in?' }).click();
  await expect(page.getByRole('heading', { name: 'Contact the administrator' })).toBeVisible();
  await page.getByLabel('Your username').fill('bursar2');
  await page.getByLabel('What is the problem?').selectOption({ label: 'I forgot my password' });
  await page.getByLabel('Phone number to reach you').fill('0772000999');
  await page.getByRole('button', { name: 'Send request to administrator' }).click();
  await expect(page.getByText('Request sent')).toBeVisible();

  const admin = await as(browser, 'admin');
  await admin.goto('/users');
  const row = admin.getByRole('row', { name: /bursar2/ }).first();
  await expect(row).toContainText('Forgot password');
  await row.getByRole('button', { name: 'Reset password' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Set temporary password' }).click();
  const temp = (await admin.getByTestId('temporary-password').textContent())!.trim();
  await admin.getByRole('button', { name: 'Done' }).click();
  await expect(admin.getByRole('row', { name: /bursar2/ }).first()).toContainText('Temporary password set');

  await page.reload();
  await page.getByLabel('Username').fill('bursar2');
  await page.getByLabel('Password').fill(temp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
});

test('the sign-in form flags empty fields, can show the password, and gives one message for any failure', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your username')).toBeVisible();
  await expect(page.getByLabel('Username')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Username')).toBeFocused();

  await page.getByLabel('Username').fill('nobody-here');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your password')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

  const password = page.getByLabel('Password', { exact: true });
  await password.fill('Wrong-pass-1');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Sign in' }).click();
  const unknownUser = await page.getByRole('alert').textContent();
  expect(unknownUser).toMatch(/could not sign you in/);
  await expect(password).toHaveAttribute('type', 'password');

  await page.getByLabel('Username').fill('auditor');
  await password.fill('Wrong-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText(unknownUser!);
});
