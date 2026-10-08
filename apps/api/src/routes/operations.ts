import { Router, Request, Response } from 'express';
import { authenticate, requireBusinessMembership } from '../middleware/auth';
import { operationalSyncService } from '../services/operations/OperationalSyncService';

const router = Router();

// GET /api/operations/sheets/status
router.get('/sheets/status', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const businessId = req.query.businessId as string;
    const status = await operationalSyncService.getStatus(businessId);
    
    return res.json({ success: true, status });
  } catch (error: any) {
    console.error('Error fetching operational sync status:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/operations/sheets/spreadsheets
router.get('/sheets/spreadsheets', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const integrationId = req.query.integrationId as string;
    if (!integrationId) return res.status(400).json({ success: false, error: 'Integration ID required' });
    
    const adapter = new (require('../services/operations/GoogleSheetsAdapter').GoogleSheetsAdapter)(integrationId);
    const spreadsheets = await adapter.listSpreadsheets();
    return res.json({ success: true, spreadsheets });
  } catch (error: any) {
    console.error('Error fetching spreadsheets:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/operations/sheets/spreadsheet-info
router.get('/sheets/spreadsheet-info', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const integrationId = req.query.integrationId as string;
    const spreadsheetId = req.query.spreadsheetId as string;
    if (!integrationId || !spreadsheetId) return res.status(400).json({ success: false, error: 'Integration ID and Spreadsheet ID required' });
    
    const adapter = new (require('../services/operations/GoogleSheetsAdapter').GoogleSheetsAdapter)(integrationId);
    const info = await adapter.getSpreadsheetInfo(spreadsheetId);
    
    res.json({ success: true, info });
  } catch (error: any) {
    console.error('Error fetching spreadsheet info:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/operations/sheets/worksheets
router.get('/sheets/worksheets', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const { integrationId, spreadsheetId } = req.query as any;
    if (!integrationId || !spreadsheetId) return res.status(400).json({ success: false, error: 'Integration ID and Spreadsheet ID required' });
    
    const adapter = new (require('../services/operations/GoogleSheetsAdapter').GoogleSheetsAdapter)(integrationId);
    const worksheets = await adapter.getWorksheets(spreadsheetId);
    return res.json({ success: true, worksheets });
  } catch (error: any) {
    console.error('Error fetching worksheets:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/operations/sheets/preview
router.get('/sheets/preview', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const { integrationId, spreadsheetId, worksheetName } = req.query as any;
    if (!integrationId || !spreadsheetId || !worksheetName) return res.status(400).json({ success: false, error: 'Missing required parameters' });
    
    const adapter = new (require('../services/operations/GoogleSheetsAdapter').GoogleSheetsAdapter)(integrationId);
    const rows = await adapter.getWorksheetPreview(spreadsheetId, worksheetName);
    return res.json({ success: true, rows });
  } catch (error: any) {
    console.error('Error previewing worksheet:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/operations/sheets/initialize
router.post('/sheets/initialize', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const { businessId, integrationId } = req.body;
    
    if (!integrationId) {
      return res.status(400).json({ success: false, error: 'Integration ID is required' });
    }

    const config = await operationalSyncService.initializeConfig(businessId, integrationId);
    
    return res.json({ success: true, config });
  } catch (error: any) {
    console.error('Error initializing operational sheet:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/operations/sheets/connect
router.post('/sheets/connect', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const { businessId, integrationId, spreadsheetId, spreadsheetName } = req.body;
    if (!integrationId || !spreadsheetId) return res.status(400).json({ success: false, error: 'Missing parameters' });

    const config = await operationalSyncService.connectSpreadsheet(businessId, integrationId, spreadsheetId, spreadsheetName);
    return res.json({ success: true, config });
  } catch (error: any) {
    console.error('Error connecting spreadsheet:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/operations/sheets/map
router.post('/sheets/map', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const { businessId, entityType, worksheetId, worksheetName, columnMapping } = req.body;
    const config = await operationalSyncService.saveMapping(businessId, entityType, worksheetId, worksheetName, columnMapping);
    return res.json({ success: true, config });
  } catch (error: any) {
    console.error('Error mapping worksheet:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/operations/sheets/disconnect
router.post('/sheets/disconnect', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.body;
    await operationalSyncService.disconnect(businessId);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Error disconnecting sheets:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/operations/sheets/sync
router.post('/sheets/sync', authenticate, requireBusinessMembership, async (req: Request, res: Response) => {
  try {
    const { businessId } = req.body;
    
    // Async fire and forget for full sync
    operationalSyncService.syncAll(businessId).catch(console.error);
    
    return res.json({ success: true, message: 'Sync started' });
  } catch (error: any) {
    console.error('Error starting sync:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export { router as operationsRouter };
