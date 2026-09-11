import cron from 'node-cron';
import { Resend } from 'resend';
import { prisma } from '../lib/prisma';
import { generateLedgerStatementPdf, type LedgerStatementPayment } from '../utils/pdf-generator';
import { generateLedgerStatementCsv } from '../utils/csv-generator';

export type ReportPeriod = 'weekly' | 'monthly';

const resend = new Resend(process.env.RESEND_API_KEY || 're_123');

export function getPeriodRange(period: ReportPeriod, from: Date = new Date()) {
  const periodEnd = new Date(from);
  const periodStart = new Date(from);

  if (period === 'weekly') {
    periodStart.setDate(periodStart.getDate() - 7);
  } else {
    periodStart.setMonth(periodStart.getMonth() - 1);
  }

  return { periodStart, periodEnd };
}

/**
 * Builds and emails one user's ledger statement (PDF + CSV) for the given
 * period. Users with no activity in the window are skipped to avoid noise.
 */
export async function generateAndSendUserReport(
  user: { id: string; email: string },
  period: ReportPeriod
) {
  const { periodStart, periodEnd } = getPeriodRange(period);

  const wallets = await prisma.wallet.findMany({
    where: { userId: user.id },
    include: {
      payments: {
        where: { receivedAt: { gte: periodStart, lte: periodEnd } },
        orderBy: { receivedAt: 'asc' },
      },
    },
  });

  const payments: LedgerStatementPayment[] = wallets.flatMap((wallet) =>
    wallet.payments.map((payment) => ({
      txHash: payment.txHash,
      fromAddress: payment.fromAddress,
      amount: payment.amount.toString(),
      asset: payment.asset,
      receivedAt: payment.receivedAt,
    }))
  );

  if (payments.length === 0) {
    console.log(`[ReportingWorker] No activity for ${user.email} this ${period} period, skipping.`);
    return null;
  }

  const primaryWallet = wallets[0];
  const pdfBuffer = await generateLedgerStatementPdf({
    userEmail: user.email,
    walletLabel: primaryWallet?.label,
    publicKey: primaryWallet?.publicKey ?? '',
    periodStart,
    periodEnd,
    payments,
  });
  const csvContent = generateLedgerStatementCsv(payments);

  const periodLabel = period === 'weekly' ? 'Weekly' : 'Monthly';
  const dateSuffix = periodEnd.toISOString().slice(0, 10);

  const { data, error } = await resend.emails.send({
    from: 'Stellar Alerts <reports@resend.dev>',
    to: [user.email],
    subject: `Your ${periodLabel} Stellar Alerts Statement (${dateSuffix})`,
    html: `
      <h1>${periodLabel} Ledger Statement</h1>
      <p>Attached are your PDF and CSV statements covering ${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}.</p>
      <p>${payments.length} transaction(s) included.</p>
    `,
    attachments: [
      {
        filename: `stellar-alerts-statement-${period}-${dateSuffix}.pdf`,
        content: pdfBuffer.toString('base64'),
      },
      {
        filename: `stellar-alerts-statement-${period}-${dateSuffix}.csv`,
        content: Buffer.from(csvContent, 'utf-8').toString('base64'),
      },
    ],
  });

  if (error) {
    throw new Error(`Resend Error: ${error.message}`);
  }

  console.log(`[ReportingWorker] 📧 Sent ${period} statement to ${user.email}`);
  return data;
}

export async function runReportingJob(period: ReportPeriod) {
  console.log(`[ReportingWorker] 🚀 Starting ${period} accounting report run...`);

  const users = await prisma.user.findMany();
  for (const user of users) {
    try {
      await generateAndSendUserReport(user, period);
    } catch (error: any) {
      console.error(`[ReportingWorker] Failed to send ${period} report to ${user.email}: ${error.message}`);
    }
  }

  console.log(`[ReportingWorker] ✅ Finished ${period} accounting report run.`);
}

export function scheduleReportingJobs() {
  // Every Monday at 06:00
  cron.schedule('0 6 * * 1', () => runReportingJob('weekly'));

  // 1st of the month at 06:00
  cron.schedule('0 6 1 * *', () => runReportingJob('monthly'));

  console.log('[ReportingWorker] 🕒 Scheduled weekly and monthly accounting report cron jobs.');
}

if (require.main === module) {
  scheduleReportingJobs();
}
