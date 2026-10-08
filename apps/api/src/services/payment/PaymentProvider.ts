export interface CreatePaymentRequest {
  businessId: string;
  invoiceId: string;
  customerId: string;
  orderId?: string;
  amount: number;
  currency: string;
}

export interface PaymentVerificationRequest {
  businessId: string;
  providerPaymentId: string;
  providerOrderId?: string;
  signature?: string;
  rawPayload?: any;
}

export interface PaymentProvider {
  name: string;
  createPaymentRequest(req: CreatePaymentRequest): Promise<{
    providerOrderId: string;
    paymentUrl?: string;
  }>;
  verifyPayment(req: PaymentVerificationRequest): Promise<boolean>;
  getPayment(providerPaymentId: string): Promise<any>;
}
