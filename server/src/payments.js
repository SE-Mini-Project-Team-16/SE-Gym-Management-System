import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { PaymentOrder, PaymentReceipt, User } from "./models.js";
import { apiError } from "./middleware/errorMiddleware.js";

// Preserve the project's existing tier amounts, represented in INR paise.
const tierAmounts = { Basic: 3000, Premium: 6000, VIP: 10000 };
const tiers = new Set(Object.keys(tierAmounts));
const currency = "INR";

function razorpayConfigured(config) {
  return Boolean(config.razorpayKeyId && config.razorpayKeySecret);
}

function signatureMatches(expectedHex, actualHex) {
  if (typeof actualHex !== "string" || !/^[a-f\d]{64}$/i.test(actualHex))
    return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(actualHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

async function razorpayRequest(config, path, options = {}) {
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...options,
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${config.razorpayKeyId}:${config.razorpayKeySecret}`,
        ).toString("base64")}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw apiError(502, "Payment service is unavailable. Please try again.");
  }
  if (!response.ok)
    throw apiError(502, "Payment service could not process the request.");
  return response.json();
}

export async function createRazorpayOrder(req, res) {
  const { tier } = req.body || {};
  if (!tiers.has(tier)) throw apiError(400, "Choose a valid membership tier.");
  const config = req.app.locals.paymentConfig;
  if (config.paymentMode === "demo") {
    const orderId = `demo_order_${randomUUID()}`;
    await PaymentOrder.create({
      orderId,
      userId: req.user._id,
      tier,
      amount: tierAmounts[tier],
      currency,
      status: "created",
    });
    return res.status(201).json({
      demo: true,
      orderId,
      amount: tierAmounts[tier],
      currency,
      tier,
    });
  }
  if (!razorpayConfigured(config))
    throw apiError(503, "Razorpay test credentials are not configured.");

  const receipt = `gms_${randomUUID().replaceAll("-", "")}`;
  const order = await razorpayRequest(config, "/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: tierAmounts[tier],
      currency,
      receipt,
      notes: { userId: String(req.user._id), tier },
    }),
  });
  if (
    typeof order.id !== "string" ||
    !order.id.startsWith("order_") ||
    order.amount !== tierAmounts[tier] ||
    order.currency !== currency
  )
    throw apiError(502, "Payment service returned an invalid order.");

  await PaymentOrder.create({
    orderId: order.id,
    userId: req.user._id,
    tier,
    amount: order.amount,
    currency: order.currency,
    status: "created",
  });
  res.status(201).json({
    keyId: config.razorpayKeyId,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    tier,
  });
}

async function fetchRazorpayPayment(config, paymentId) {
  const payment = await razorpayRequest(
    config,
    `/payments/${encodeURIComponent(paymentId)}`,
  );
  if (
    payment.id !== paymentId ||
    typeof payment.order_id !== "string" ||
    !Number.isSafeInteger(payment.amount) ||
    payment.currency !== currency
  )
    throw apiError(400, "Payment details do not match the membership order.");
  return payment;
}

async function activateCapturedPayment(orderId, payment, config) {
  const session = await mongoose.startSession();
  let expiry;
  try {
    await session.withTransaction(async () => {
      const order = await PaymentOrder.findOne({ orderId: orderId })
        .session(session)
        .lean();
      if (!order) throw apiError(404, "Membership payment order not found.");
      if (
        payment.order_id !== order.orderId ||
        payment.amount !== order.amount ||
        payment.currency !== order.currency ||
        payment.status !== "captured" ||
        payment.captured !== true
      )
        throw apiError(400, "Payment has not been captured for this order.");

      if (order.status === "paid") {
        if (order.paymentId !== payment.id)
          throw apiError(409, "This membership order was already paid.");
        const existing = await PaymentReceipt.findOne({
          orderId: orderId,
          paymentId: payment.id,
        })
          .session(session)
          .lean();
        if (!existing) throw apiError(409, "Payment receipt is unavailable.");
        expiry = existing.membershipExpiresAt;
        return;
      }

      const member = await User.findOne({
        _id: order.userId,
        role: "Member",
        disabled: false,
      })
        .session(session)
        .lean();
      if (!member) throw apiError(400, "Payment member account is unavailable.");
      const base = Math.max(
        Date.now(),
        member.membershipExpiresAt
          ? new Date(member.membershipExpiresAt).getTime()
          : 0,
      );
      expiry = new Date(base + config.membershipDurationDays * 86_400_000);

      await PaymentReceipt.create(
        [
          {
            orderId: orderId,
            paymentId: payment.id,
            userId: order.userId,
            tier: order.tier,
            amount: payment.amount,
            currency: payment.currency,
            membershipExpiresAt: expiry,
          },
        ],
        { session },
      );
      const userUpdate = await User.updateOne(
        { _id: order.userId, role: "Member", disabled: false },
        { $set: { tier: order.tier, membershipExpiresAt: expiry } },
        { session },
      );
      const orderUpdate = await PaymentOrder.updateOne(
        { _id: order._id, status: "created" },
        { $set: { status: "paid", paymentId: payment.id } },
        { session },
      );
      if (userUpdate.modifiedCount !== 1 || orderUpdate.modifiedCount !== 1)
        throw apiError(409, "Membership could not be updated.");
    });
  } catch (error) {
    // The browser callback and payment.captured webhook can arrive together.
    if (error.code === 11000) {
      const existing = await PaymentReceipt.findOne({
        orderId: orderId,
        paymentId: payment.id,
      }).lean();
      if (existing) return existing.membershipExpiresAt;
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return expiry;
}

export async function verifyRazorpayPayment(req, res) {
  const config = req.app.locals.paymentConfig;
  if (config.paymentMode === "demo") {
    const { orderId, outcome } = req.body || {};
    if (typeof orderId !== "string" || !orderId.startsWith("demo_order_"))
      throw apiError(400, "Demo payment order is invalid.");
    if (!["success", "failure"].includes(outcome))
      throw apiError(400, "Choose a demo payment result.");
    const order = await PaymentOrder.findOne({ orderId, userId: req.user._id });
    if (!order) throw apiError(404, "Demo payment order not found.");
    if (outcome === "failure")
      return res.json({ status: "failed", demo: true });
    const payment = {
      id: `demo_payment_${randomUUID()}`,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      status: "captured",
      captured: true,
    };
    const membershipExpiresAt = await activateCapturedPayment(
      order.orderId,
      payment,
      config,
    );
    return res.json({ status: "paid", demo: true, membershipExpiresAt });
  }
  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: suppliedSignature,
  } = req.body || {};
  if (
    typeof orderId !== "string" ||
    !orderId.startsWith("order_") ||
    typeof paymentId !== "string" ||
    !paymentId.startsWith("pay_")
  )
    throw apiError(400, "Payment response is incomplete.");

  if (!razorpayConfigured(config))
    throw apiError(503, "Razorpay credentials are not configured.");
  const order = await PaymentOrder.findOne({
    orderId: orderId,
    userId: req.user._id,
  }).lean();
  if (!order) throw apiError(404, "Membership payment order not found.");
  const expectedSignature = sign(
    `${order.orderId}|${paymentId}`,
    config.razorpayKeySecret,
  );
  if (!signatureMatches(expectedSignature, suppliedSignature))
    throw apiError(400, "Payment signature is invalid.");

  const payment = await fetchRazorpayPayment(config, paymentId);
  if (payment.order_id !== order.orderId)
    throw apiError(400, "Payment does not belong to this membership order.");
  if (payment.status !== "captured" || payment.captured !== true)
    return res.status(202).json({ status: "processing" });

  const membershipExpiresAt = await activateCapturedPayment(
    order.orderId,
    payment,
    config,
  );
  res.json({ status: "paid", membershipExpiresAt });
}

export function razorpayWebhook(config) {
  return async (req, res, next) => {
    try {
      if (!config.razorpayWebhookSecret)
        throw apiError(503, "Razorpay webhook secret is not configured.");
      if (!Buffer.isBuffer(req.body))
        throw apiError(400, "Webhook body is invalid.");
      const expectedSignature = sign(
        req.body.toString("utf8"),
        config.razorpayWebhookSecret,
      );
      if (
        !signatureMatches(
          expectedSignature,
          req.headers["x-razorpay-signature"],
        )
      )
        throw apiError(400, "Razorpay webhook signature is invalid.");

      let event;
      try {
        event = JSON.parse(req.body.toString("utf8"));
      } catch {
        throw apiError(400, "Webhook body must contain valid JSON.");
      }
      if (event.event !== "payment.captured")
        return res.json({ received: true });
      const payment = event.payload?.payment?.entity;
      if (
        !payment ||
        typeof payment.id !== "string" ||
        typeof payment.order_id !== "string" ||
        payment.status !== "captured" ||
        payment.captured !== true
      )
        throw apiError(400, "Captured payment event is invalid.");

      await activateCapturedPayment(payment.order_id, payment, config);
      res.json({ received: true });
    } catch (error) {
      next(error);
    }
  };
}
