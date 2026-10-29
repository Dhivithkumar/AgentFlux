import { Router } from 'express';
import { CustomerFormService } from '../services/order/CustomerFormService';

export const formsRouter = Router();

formsRouter.get('/customer-details/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const details = await CustomerFormService.getFormDetails(token);
    res.json(details);
  } catch (error: any) {
    const isClientError = error.message.startsWith('FORM_TOKEN_') || error.message.startsWith('ACCESS_DENIED');
    res.status(isClientError ? 400 : 500).json({
      error: error.message
    });
  }
});

formsRouter.post('/customer-details/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { billingAddress, city, state, pincode, phone, gstin } = req.body;

    const result = await CustomerFormService.submitFormDetails(token, {
      billingAddress,
      city,
      state,
      pincode,
      phone,
      gstin
    });

    res.json(result);
  } catch (error: any) {
    const isClientError = error.message.startsWith('VALIDATION_FAILED') || 
                          error.message.startsWith('FORM_TOKEN_') || 
                          error.message.startsWith('ACCESS_DENIED');
    res.status(isClientError ? 400 : 500).json({
      error: error.message
    });
  }
});
