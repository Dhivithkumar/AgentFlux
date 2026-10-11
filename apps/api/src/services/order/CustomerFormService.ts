import crypto from 'crypto';
import { LifecycleStateMachine } from './LifecycleStateMachine';
import { EventBus } from '../eventBus';

const FORM_SIGNING_SECRET = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || 'agent-flux-customer-form-secret-key-32b';

export interface FormTokenPayload {
  businessId: string;
  orderId: string;
  customerId: string;
  expiresAt: number;
}

export interface CustomerBillingSubmission {
  billingAddress: string;
  city: string;
  state: string;
  pincode: string;
  phone?: string;
  gstin?: string;
}

export class CustomerFormService {
  /**
   * Generates a tamper-proof, expiring token scoped to business, order, and customer.
   */
  static generateFormToken(businessId: string, orderId: string, customerId: string, expiresInHours: number = 48): string {
    const expiresAt = Date.now() + (expiresInHours * 3600 * 1000);
    const payload: FormTokenPayload = {
      businessId,
      orderId,
      customerId,
      expiresAt
    };

    const payloadJson = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadJson).toString('base64url');
    
    const signature = crypto
      .createHmac('sha256', FORM_SIGNING_SECRET)
      .update(payloadB64)
      .digest('base64url');

    return `${payloadB64}.${signature}`;
  }

  /**
   * Verifies and decodes the customer form token.
   * Rejects expired, tampered, or malformed tokens.
   */
  static verifyFormToken(token: string): FormTokenPayload {
    if (!token || typeof token !== 'string' || !token.includes('.')) {
      throw new Error('FORM_TOKEN_INVALID: Malformed or missing token');
    }

    const [payloadB64, signature] = token.split('.');
    const expectedSignature = crypto
      .createHmac('sha256', FORM_SIGNING_SECRET)
      .update(payloadB64)
      .digest('base64url');

    if (signature !== expectedSignature) {
      throw new Error('FORM_TOKEN_INVALID: Token signature verification failed');
    }

    try {
      const payload: FormTokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

      if (!payload.businessId || !payload.orderId || !payload.customerId || !payload.expiresAt) {
        throw new Error('FORM_TOKEN_INVALID: Incomplete token payload');
      }

      if (Date.now() > payload.expiresAt) {
        throw new Error('FORM_TOKEN_EXPIRED: This customer details form link has expired. Please request a new link.');
      }

      return payload;
    } catch (e: any) {
      if (e.message.startsWith('FORM_TOKEN_')) throw e;
      throw new Error('FORM_TOKEN_INVALID: Could not decode token');
    }
  }

  /**
   * Generates the customer-facing form URL.
   */
  static getFormUrl(token: string): string {
    const baseUrl = process.env.APP_URL || process.env.API_URL || 'http://localhost:3000';
    return `${baseUrl}/forms/customer-details?token=${token}`;
  }

  /**
   * Retrieves secure form details for display.
   * Ensures the customer cannot access another customer's order.
   */
  static async getFormDetails(token: string): Promise<any> {
    const payload = this.verifyFormToken(token);
    const { prisma } = require('@agent-flux/database');

    const order = await prisma.order.findUnique({
      where: { id: payload.orderId },
      include: {
        customer: true,
        business: true
      }
    });

    if (!order) {
      throw new Error('ORDER_NOT_FOUND: Referenced order does not exist');
    }

    if (order.businessId !== payload.businessId || order.customerId !== payload.customerId) {
      throw new Error('ACCESS_DENIED: Token does not match order customer or business');
    }

    const customerData = (order.customer.customData as any) || {};
    const orderData = (order.structuredData as any) || {};

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      businessName: order.business?.name || 'Business',
      customerName: order.customer?.name || '',
      customerEmail: order.customer?.email || '',
      currentPhone: order.customer?.phone || '',
      currentBillingAddress: orderData.billingAddress || customerData.billingAddress || '',
      currentCity: orderData.city || customerData.city || '',
      currentState: orderData.state || customerData.state || '',
      currentPincode: orderData.pincode || customerData.pincode || '',
      currentGstin: orderData.gstin || customerData.gstin || '',
      orderStatus: order.status,
      totalAmount: order.totalAmount,
      currency: order.currency || 'INR',
      expiresAt: new Date(payload.expiresAt).toISOString()
    };
  }

  /**
   * Submits and validates customer billing details.
   * Persists them to customer and order records with audit timestamps.
   * Progresses the order status to READY_FOR_INVOICE.
   */
  static async submitFormDetails(token: string, data: CustomerBillingSubmission): Promise<any> {
    const payload = this.verifyFormToken(token);

    // 1. Validation
    if (!data.billingAddress || data.billingAddress.trim().length < 5) {
      throw new Error('VALIDATION_FAILED: Billing address is required (minimum 5 characters)');
    }
    if (!data.city || data.city.trim().length < 2) {
      throw new Error('VALIDATION_FAILED: City is required');
    }
    if (!data.state || data.state.trim().length < 2) {
      throw new Error('VALIDATION_FAILED: State is required');
    }
    if (!data.pincode || data.pincode.trim().length < 3) {
      throw new Error('VALIDATION_FAILED: Valid PIN / postal code is required');
    }

    const { prisma } = require('@agent-flux/database');
    const order = await prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { customer: true }
    });

    if (!order) {
      throw new Error('ORDER_NOT_FOUND: Referenced order does not exist');
    }

    if (order.businessId !== payload.businessId || order.customerId !== payload.customerId) {
      throw new Error('ACCESS_DENIED: Token does not match order ownership');
    }

    const now = new Date();
    const formattedAddress = `${data.billingAddress.trim()}, ${data.city.trim()}, ${data.state.trim()} - ${data.pincode.trim()}`;

    // 2. Persist to Customer record
    const existingCustomData = (order.customer.customData as any) || {};
    const updatedCustomData = {
      ...existingCustomData,
      billingAddress: formattedAddress,
      streetAddress: data.billingAddress.trim(),
      city: data.city.trim(),
      state: data.state.trim(),
      pincode: data.pincode.trim(),
      gstin: data.gstin ? data.gstin.trim() : existingCustomData.gstin,
      billingAddressUpdatedAt: now.toISOString()
    };

    await prisma.customer.update({
      where: { id: order.customerId },
      data: {
        phone: data.phone?.trim() || order.customer.phone,
        customData: updatedCustomData
      }
    });

    // 3. Persist to Order record
    const existingStructured = (order.structuredData as any) || {};
    const updatedStructured = {
      ...existingStructured,
      billingAddress: formattedAddress,
      city: data.city.trim(),
      state: data.state.trim(),
      pincode: data.pincode.trim(),
      gstin: data.gstin ? data.gstin.trim() : existingStructured.gstin,
      billingDetailsCompletedAt: now.toISOString()
    };

    // 4. Transition order state to READY_FOR_INVOICE
    const updatedOrder = await prisma.$transaction(async (tx: any) => {
      const uOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          structuredData: updatedStructured,
          status: 'READY_FOR_INVOICE'
        }
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'READY_FOR_INVOICE',
          reason: 'Customer submitted verified billing details via secure form',
          changedById: null
        }
      });

      return uOrder;
    });

    // 5. Emit event for downstream workflow (triggers invoice generation)
    EventBus.publish(payload.businessId, 'ORDER_CONFIRMED', {
      orderId: order.id,
      customerId: order.customerId,
      businessId: payload.businessId
    });

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: updatedOrder.status,
      billingAddress: formattedAddress,
      updatedAt: now.toISOString()
    };
  }
}
