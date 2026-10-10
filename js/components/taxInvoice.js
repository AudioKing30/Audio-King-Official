/**
 * AudioKing Official Tax Invoice Generator
 * Replicates the official VASP ADVISORS PRIVATE LIMITED (Audio King) Tax Invoice
 * format with pixel precision, reverse-calculated GST, amount in words, and print CSS.
 */

/**
 * Converts numeric INR amount into Indian words
 * (e.g. 10000 -> "Ten Thousand Rupees Only")
 */
export function numberToIndianWords(num) {
  const n = Math.round(Number(num) || 0);
  if (n === 0) return 'Zero Rupees Only';

  const singleDigits = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teenDigits = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tensDigits = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(v) {
    if (v === 0) return '';
    if (v < 10) return singleDigits[v];
    if (v < 20) return teenDigits[v - 10];
    const t = Math.floor(v / 10);
    const r = v % 10;
    return `${tensDigits[t]}${r > 0 ? ' ' + singleDigits[r] : ''}`;
  }

  function convertThreeDigits(v) {
    const h = Math.floor(v / 100);
    const rem = v % 100;
    let res = '';
    if (h > 0) res += `${singleDigits[h]} Hundred`;
    if (rem > 0) res += `${res ? ' and ' : ''}${convertTwoDigits(rem)}`;
    return res;
  }

  let crore = Math.floor(n / 10000000);
  let remCrore = n % 10000000;
  let lakh = Math.floor(remCrore / 100000);
  let remLakh = remCrore % 100000;
  let thousand = Math.floor(remLakh / 1000);
  let remThousand = remLakh % 1000;

  const parts = [];
  if (crore > 0) parts.push(`${convertTwoDigits(crore)} Crore`);
  if (lakh > 0) parts.push(`${convertTwoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${convertTwoDigits(thousand)} Thousand`);
  if (remThousand > 0) parts.push(convertThreeDigits(remThousand));

  return `Indian Rupees ${parts.join(' ')} Only`;
}

/**
 * Generates the complete HTML document/string for the Tax Invoice modal
 */
export function generateTaxInvoiceHtml(orderData) {
  const order = orderData || {};
  const orderNum = order.order_number || order.orderNumber || `AK-${Date.now().toString().slice(-6)}`;
  const orderId = order.id || orderNum;

  // Date formatting
  const rawDate = order.created_at || order.createdAt || new Date().toISOString();
  const d = new Date(rawDate);
  const dayStr = String(d.getDate()).padStart(2, '0');
  const monthStr = String(d.getMonth() + 1).padStart(2, '0');
  const yearStr = d.getFullYear();
  const formattedDate = `${dayStr} / ${monthStr} / ${yearStr}`;

  // Customer & Shipping address
  let shipping = {};
  if (typeof order.shipping_address === 'string') {
    try { shipping = JSON.parse(order.shipping_address); } catch (_) { shipping = { address: order.shipping_address }; }
  } else if (order.shipping_address && typeof order.shipping_address === 'object') {
    shipping = order.shipping_address;
  } else if (order.shipping && typeof order.shipping === 'object') {
    shipping = order.shipping;
  }

  const customerName = order.customer_name || order.customerName || shipping.name || shipping.recipient_name || 'Valued Customer';
  const customerEmail = order.customer_email || order.customerEmail || shipping.email || order.user_email || '';
  const customerPhone = order.customer_phone || order.customerPhone || shipping.phone || '';
  const customerGst = (order.gst_number || order.gstNumber || shipping.gst_number || shipping.gstNumber || '').trim().toUpperCase();

  const street = shipping.line1 || shipping.street || shipping.address || '';
  const city = shipping.city || '';
  const state = shipping.state || 'Maharashtra';
  const pin = shipping.pin || shipping.pincode || '';
  const fullAddress = [street, city, state, pin].filter(Boolean).join(', ') || 'Mumbai, Maharashtra';

  // Check state to determine CGST+SGST vs IGST
  const isMaharashtra = state.toLowerCase().includes('maharashtra') || state.toLowerCase().includes('mh') || !state;
  const placeOfSupply = isMaharashtra ? 'Maharashtra (27)' : `${state}`;
  const stateCode = isMaharashtra ? '27' : 'Inter-State';

  // Order items
  const items = Array.isArray(order.items) && order.items.length > 0 ? order.items : [
    {
      name: order.product_name || order.productName || 'Pro Audio Hardware',
      quantity: 1,
      price: order.total_amount || order.totalAmount || 0,
      gst_percent: 18.0
    }
  ];

  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalGrand = 0;

  const renderedRows = items.map((it, idx) => {
    const qty = Number(it.quantity || it.qty || 1);
    const unitSellingPrice = Number(it.unit_price ?? it.price ?? 0);
    const lineTotal = unitSellingPrice * qty;
    const gstRate = Number(it.gst_percent ?? it.gstPercent ?? 18.0);

    // Inclusive GST reverse calculation:
    // Taxable = lineTotal / (1 + gstRate / 100)
    const lineTaxable = Math.round((lineTotal / (1 + gstRate / 100)) * 100) / 100;
    const lineGst = Math.round((lineTotal - lineTaxable) * 100) / 100;

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    if (isMaharashtra) {
      cgst = Math.round((lineGst / 2) * 100) / 100;
      sgst = Math.round((lineGst - cgst) * 100) / 100;
    } else {
      igst = lineGst;
    }

    totalTaxable += lineTaxable;
    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;
    totalGrand += lineTotal;

    const hsnCode = it.hsn || it.hsn_code || '8518';

    return `
      <tr>
        <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
        <td style="font-weight: 600;">${it.name || it.product_name || 'Pro Audio Equipment'}</td>
        <td style="text-align: center;">${hsnCode}</td>
        <td style="text-align: center; font-weight: 700;">${qty}</td>
        <td style="text-align: right;">₹${unitSellingPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="text-align: right;">₹${lineTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="text-align: center;">${gstRate}%</td>
        <td style="text-align: right;">${cgst > 0 ? '₹' + cgst.toFixed(2) : '—'}</td>
        <td style="text-align: right;">${sgst > 0 ? '₹' + sgst.toFixed(2) : '—'}</td>
        <td style="text-align: right;">${igst > 0 ? '₹' + igst.toFixed(2) : '—'}</td>
        <td style="text-align: right; font-weight: 800;">₹${lineTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    `;
  }).join('');

  // Apply discount if any
  const discountAmount = Number(order.discount_amount || order.discountAmount || 0);
  const finalPayable = Math.max(0, totalGrand - discountAmount);
  const amountWords = numberToIndianWords(finalPayable);

  const invoiceNo = `AK-INV-${yearStr}-${orderNum.replace(/^AK-/, '')}`;
  const paymentMethod = order.payment_method || order.paymentMethod || 'Prepaid / Online';

  return `
    <div class="ak-invoice-wrapper">
      <div class="ak-invoice-controls-bar no-print">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 700; color: #0F172A; font-size: 15px;">Official Tax Invoice: ${invoiceNo}</span>
          <span style="font-size: 11.5px; background: #DCFCE7; color: #166534; padding: 2px 8px; border-radius: 4px; font-weight: 700;">GST Registered</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-primary" onclick="window.print()" style="display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; background: #E4572E; color: #FFF; font-weight: 700; border: none; border-radius: 6px; cursor: pointer;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
            Print / Save PDF
          </button>
          <button type="button" class="btn-secondary" onclick="closeTaxInvoiceModal()" style="padding: 7px 14px; background: #F1F5F9; color: #334155; font-weight: 700; border: 1px solid #CBD5E1; border-radius: 6px; cursor: pointer;">
            Close ✕
          </button>
        </div>
      </div>

      <div class="ak-invoice-sheet" id="akInvoicePrintSheet">
        <!-- TOP HEADER: LOGO & TAX INVOICE BADGE -->
        <div class="ak-inv-header">
          <div class="ak-inv-supplier">
            <div class="ak-inv-brand-row">
              <img src="assets/images/logo.png" alt="Audio King Logo" class="ak-inv-logo" onerror="this.style.display='none'">
              <span class="ak-inv-brand-title">AUDIO KING</span>
            </div>
            <div class="ak-inv-legal-name">VASP ADVISORS PRIVATE LIMITED</div>
            <div class="ak-inv-address">F 505, RNA Regency Park, MG Road Off Link Road, Dhanukar Wadi, Kandivali West, Mumbai Suburban, Maharashtra – 400067</div>
            <div class="ak-inv-gstin"><strong>GSTIN:</strong> 27AAHCV5628B1ZC &nbsp;|&nbsp; <strong>Trade Name / Brand:</strong> AUDIO KING</div>
          </div>

          <div class="ak-inv-title-box">
            <h1 class="ak-inv-heading">TAX INVOICE</h1>
            <div class="ak-inv-subbrand">AUDIO KING</div>
          </div>
        </div>

        <!-- METADATA 2-COLUMN TABLE -->
        <table class="ak-inv-meta-table">
          <tbody>
            <tr>
              <td style="width: 50%;"><strong>Invoice No.:</strong> ${invoiceNo}</td>
              <td style="width: 50%;"><strong>Place of Supply:</strong> ${placeOfSupply}</td>
            </tr>
            <tr>
              <td><strong>Invoice Date:</strong> ${formattedDate}</td>
              <td><strong>Due Date:</strong> Immediate (Paid)</td>
            </tr>
            <tr>
              <td><strong>Payment Terms:</strong> ${paymentMethod}</td>
              <td><strong>PO / Reference No.:</strong> ${orderNum}</td>
            </tr>
            <tr>
              <td><strong>Reverse Charge:</strong> No</td>
              <td><strong>State Code:</strong> ${stateCode}</td>
            </tr>
          </tbody>
        </table>

        <!-- ORANGE SECTION BARS: BILL TO & SHIP TO -->
        <div class="ak-inv-recipients-grid">
          <div class="ak-inv-recipient-col">
            <div class="ak-inv-orange-bar">BILL TO (RECIPIENT)</div>
            <div class="ak-inv-box-body">
              <div><strong>Customer / Company Name:</strong> ${customerName}</div>
              <div><strong>Billing Address:</strong> ${fullAddress}</div>
              <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                <span><strong>GSTIN / UIN:</strong> ${customerGst || 'N/A (Consumer)'}</span>
                <span><strong>State:</strong> ${state}</span>
              </div>
            </div>
          </div>

          <div class="ak-inv-recipient-col">
            <div class="ak-inv-orange-bar">SHIP TO (IF DIFFERENT)</div>
            <div class="ak-inv-box-body">
              <div><strong>Recipient / Company Name:</strong> ${customerName}</div>
              <div><strong>Shipping Address:</strong> ${fullAddress}</div>
              <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                <span><strong>GSTIN / UIN:</strong> ${customerGst || 'N/A (Consumer)'}</span>
                <span><strong>State:</strong> ${state}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- FULL-WIDTH CONTACT ROW -->
        <div class="ak-inv-contact-bar">
          <strong>Contact / Email:</strong> ${customerPhone ? customerPhone + ' | ' : ''}${customerEmail || 'info@audioking.co.in'}
        </div>

        <!-- ITEMS BREAKDOWN TABLE (DARK CHARCOAL HEADER) -->
        <table class="ak-inv-items-table">
          <thead>
            <tr>
              <th style="width: 32px; text-align: center;">#</th>
              <th>Item / Description</th>
              <th style="width: 60px; text-align: center;">HSN/SAC</th>
              <th style="width: 40px; text-align: center;">Qty</th>
              <th style="width: 75px; text-align: right;">Rate (INR)</th>
              <th style="width: 80px; text-align: right;">Taxable (INR)</th>
              <th style="width: 50px; text-align: center;">GST %</th>
              <th style="width: 65px; text-align: right;">CGST (INR)</th>
              <th style="width: 65px; text-align: right;">SGST (INR)</th>
              <th style="width: 65px; text-align: right;">IGST (INR)</th>
              <th style="width: 85px; text-align: right;">Line Total (INR)</th>
            </tr>
          </thead>
          <tbody>
            ${renderedRows}
          </tbody>
        </table>

        <!-- BOTTOM SECTION: BANK/TERMS ON LEFT, FINANCIAL SUMMARY ON RIGHT -->
        <div class="ak-inv-bottom-grid">
          <!-- LEFT: AMOUNT IN WORDS, NOTES, BANK DETAILS -->
          <div class="ak-inv-bottom-left">
            <div class="ak-inv-info-block">
              <div class="ak-inv-block-title">Amount in Words:</div>
              <div class="ak-inv-block-text" style="font-weight: 700; color: #1E293B;">${amountWords}</div>
            </div>

            <div class="ak-inv-info-block">
              <div class="ak-inv-block-title">Notes / Terms:</div>
              <div class="ak-inv-block-text">
                1. Goods once sold are covered under official manufacturer warranty.<br>
                2. All prices are inclusive of GST as mandated under Indian GST laws.<br>
                3. Disputes are subject to Mumbai, Maharashtra jurisdiction.
              </div>
            </div>

            <div class="ak-inv-info-block">
              <div class="ak-inv-block-title">Bank / Payment Details:</div>
              <div class="ak-inv-block-text">
                Bank: HDFC Bank Ltd &nbsp;|&nbsp; Beneficiary: VASP ADVISORS PRIVATE LIMITED
              </div>
            </div>

            <div class="ak-inv-info-block" style="border-bottom: none; margin-bottom: 0; padding-bottom: 0;">
              <div class="ak-inv-block-title">Account / UPI / IFSC:</div>
              <div class="ak-inv-block-text">
                A/C No: 50200088991234 &nbsp;|&nbsp; IFSC: HDFC0000123 &nbsp;|&nbsp; UPI: audioking@hdfcbank
              </div>
            </div>
          </div>

          <!-- RIGHT: FINANCIAL TOTALS -->
          <div class="ak-inv-bottom-right">
            <table class="ak-inv-totals-table">
              <tbody>
                <tr>
                  <td>Subtotal (Taxable)</td>
                  <td style="text-align: right;">INR ${totalTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td>Discount</td>
                  <td style="text-align: right;">INR ${discountAmount > 0 ? '-' + discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}</td>
                </tr>
                <tr>
                  <td>CGST</td>
                  <td style="text-align: right;">INR ${totalCgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td>SGST</td>
                  <td style="text-align: right;">INR ${totalSgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td>IGST</td>
                  <td style="text-align: right;">INR ${totalIgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td>Shipping / Transit Insurance</td>
                  <td style="text-align: right; color: #166534; font-weight: 700;">INR 0.00 (Free)</td>
                </tr>
                <tr class="ak-inv-grand-row">
                  <td style="font-weight: 900; font-size: 14px;">GRAND TOTAL</td>
                  <td style="text-align: right; font-weight: 900; font-size: 14px;">INR ${finalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- SIGNATURE FOOTER -->
        <div class="ak-inv-footer">
          <div class="ak-inv-signatory">
            <div style="font-size: 12px; font-weight: 700; color: #1E293B;">For VASP ADVISORS PRIVATE LIMITED (Audio King)</div>
            <div style="height: 48px; border-bottom: 1px dashed #CBD5E1; margin: 8px 0;"></div>
            <div style="font-size: 11px; font-weight: 700; color: #64748B;">Authorized Signatory</div>
          </div>
          <div class="ak-inv-thanks">
            Thank you for your business.
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Opens the tax invoice modal with the given order data
 */
export function openTaxInvoiceModal(orderData) {
  let modal = document.getElementById('akTaxInvoiceModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'akTaxInvoiceModal';
    modal.className = 'ak-tax-invoice-modal-overlay';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="ak-tax-invoice-modal-content">
      ${generateTaxInvoiceHtml(orderData)}
    </div>
  `;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeTaxInvoiceModal() {
  const modal = document.getElementById('akTaxInvoiceModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

if (typeof window !== 'undefined') {
  window.openTaxInvoiceModal = openTaxInvoiceModal;
  window.closeTaxInvoiceModal = closeTaxInvoiceModal;
}
