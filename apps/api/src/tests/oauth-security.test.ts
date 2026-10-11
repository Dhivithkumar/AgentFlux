import '../env';
import { EventDispatcher } from '../services/workflow/eventDispatcher';
import { prisma } from '@agent-flux/database';
import { encrypt, decrypt } from '../services/encryption';
import assert from 'assert';

// Basic mock implementation for test suite
const runTests = async () => {
    console.log('--- STARTING OAUTH TOKEN SECURITY TESTS ---');

    let executeCalls: any[] = [];
    
    // Mock the Gmail action
    const mockGmailAction = {
        id: 'send_email',
        execute: async (auth: any, emailParams: any) => {
            executeCalls.push({ auth, emailParams });
            return { status: 'Success' };
        }
    };
    
    // Mock googleapis
    const mockRefreshAccessToken = async () => {
        return {
            credentials: {
                access_token: 'new_plaintext_access_token',
                refresh_token: 'new_plaintext_refresh_token',
                expiry_date: Date.now() + 3600000
            }
        };
    };

    const mockOAuth2Client = {
        setCredentials: (creds: any) => {
            mockOAuth2Client.lastCreds = creds;
        },
        refreshAccessToken: mockRefreshAccessToken,
        lastCreds: null as any
    };

    // Override require for googleapis and gmail action inside the test context
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function() {
        if (arguments[0] === 'googleapis') {
            return {
                google: {
                    auth: {
                        OAuth2: function() { return mockOAuth2Client; }
                    }
                }
            };
        }
        if (arguments[0] === '../../connectors/actions/gmail') {
            return { gmailActions: [mockGmailAction] };
        }
        return originalRequire.apply(this, arguments as any);
    };

    // --- Setup Test Data ---
    const businessId = 'test-business-123';
    const integrationId = 'test-integration-123';
    const credsId = 'test-creds-123';
    const orderId = 'test-order-123';
    
    // Ensure clean state
    const cleanState = async () => {
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } }).catch(() => {});
        await prisma.invoice.deleteMany({ where: { businessId } }).catch(() => {});
        await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
        await prisma.knowledgeDocument.deleteMany({ where: { businessId } }).catch(() => {});
        await prisma.knowledgeBase.deleteMany({ where: { businessId } }).catch(() => {});
        await prisma.customer.deleteMany({ where: { businessId } }).catch(() => {});
        await prisma.integrationCredential.deleteMany({ where: { id: credsId } }).catch(() => {});
        await prisma.integration.deleteMany({ where: { id: integrationId } }).catch(() => {});
        await prisma.business.deleteMany({ where: { id: businessId } }).catch(() => {});
    };

    try {
        await cleanState();

        await prisma.business.create({ 
            data: { 
                id: businessId, 
                name: 'Test Business', 
                industry: 'Tech',
                contactInfo: { addressLine1: '123 Main St' },
                preferences: { gstin: '22AAAAA0000A1Z5', defaultTaxRate: 10 }
            } 
        });
        await prisma.integration.create({
            data: {
                id: integrationId,
                businessId,
                provider: 'GMAIL',
                status: 'CONNECTED',
                accountId: 'test@example.com'
            }
        });

        // Test Case 1: Valid Tokens (No refresh needed)
        console.log('Test Case 1: Valid Tokens');
        const validAccessToken = 'valid_access_token';
        await prisma.integrationCredential.create({
            data: {
                id: credsId,
                integrationId,
                accessTokenEncrypted: encrypt(validAccessToken),
                refreshTokenEncrypted: encrypt('valid_refresh_token'),
                expiresAt: new Date(Date.now() + 3600000) // Valid for 1 hour
            }
        });

        const customerId = 'test-customer';
        await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
        await prisma.customer.create({
            data: { id: customerId, businessId, name: 'Test Customer', email: 'test@example.com' }
        });

        const kbId = 'test-kb-123';
        await prisma.knowledgeBase.deleteMany({ where: { id: kbId } }).catch(() => {});
        await prisma.knowledgeBase.create({
            data: { id: kbId, businessId, name: 'Test KB' }
        });

        await prisma.knowledgeDocument.create({
            data: {
                businessId,
                knowledgeBaseId: kbId,
                filename: 'Invoice_Template.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                fileSize: 100,
                storagePath: '/mock/path',
                contentHash: 'hash',
                status: 'INDEXED',
                knowledgeType: 'OTHER'
            }
        });

        await prisma.order.create({
            data: {
                id: orderId,
                businessId,
                orderNumber: 'ORD-TEST',
                status: 'CONFIRMED',
                customerId,
                source: 'TEST'
            }
        });

        executeCalls = [];
        await EventDispatcher.dispatch(businessId, 'ORDER_CONFIRMED', { orderId });
        
        assert.strictEqual(executeCalls.length, 1, 'Gmail action should be called once');
        assert.strictEqual(executeCalls[0].auth.accessToken, validAccessToken, 'Access token should be decrypted before Gmail execution');
        
        const orderAfter1 = await prisma.order.findUnique({ where: { id: orderId } });
        assert.strictEqual(orderAfter1?.status, 'CUSTOMER_INFORMATION_REQUIRED', 'Order status should be updated');


        // Test Case 2: Expired Token -> Refresh -> Encrypt
        console.log('Test Case 2: Expired Token Refresh');
        await prisma.integrationCredential.update({
            where: { id: credsId },
            data: { expiresAt: new Date(Date.now() - 3600000) } // Expired 1 hour ago
        });
        
        // Reset order status
        await prisma.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } });

        executeCalls = [];
        mockOAuth2Client.lastCreds = null;
        await EventDispatcher.dispatch(businessId, 'ORDER_CONFIRMED', { orderId });

        assert.strictEqual(mockOAuth2Client.lastCreds.refresh_token, 'valid_refresh_token', 'Refresh token should be decrypted before refresh');
        assert.strictEqual(executeCalls[0].auth.accessToken, 'new_plaintext_access_token', 'New access token should be passed to Gmail execution');
        
        const credsAfter2 = await prisma.integrationCredential.findUnique({ where: { id: credsId } });
        assert.notStrictEqual(credsAfter2?.accessTokenEncrypted, 'new_plaintext_access_token', 'Access token MUST NOT be stored in plaintext');
        assert.strictEqual(decrypt(credsAfter2!.accessTokenEncrypted), 'new_plaintext_access_token', 'Access token should be correctly encrypted in DB');
        assert.strictEqual(decrypt(credsAfter2!.refreshTokenEncrypted!), 'new_plaintext_refresh_token', 'Refresh token should be correctly encrypted in DB');

        
        // Test Case 3: Missing replacement refresh token preserves the valid stored refresh token
        console.log('Test Case 3: Missing Replacement Refresh Token');
        mockOAuth2Client.refreshAccessToken = (async () => ({
            credentials: {
                access_token: 'another_access_token',
                expiry_date: Date.now() + 3600000
            }
        })) as any;
        await prisma.integrationCredential.update({
            where: { id: credsId },
            data: { expiresAt: new Date(Date.now() - 3600000) } // Expired again
        });
        await prisma.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } });
        
        await EventDispatcher.dispatch(businessId, 'ORDER_CONFIRMED', { orderId });
        
        const credsAfter3 = await prisma.integrationCredential.findUnique({ where: { id: credsId } });
        assert.strictEqual(decrypt(credsAfter3!.refreshTokenEncrypted!), 'new_plaintext_refresh_token', 'Previous refresh token MUST be preserved if not replaced');


        // Test Case 4: Refresh failure (e.g., revoked) transitions to RECONNECT_REQUIRED
        console.log('Test Case 4: Revoked Credentials');
        mockOAuth2Client.refreshAccessToken = async () => {
            const err = new Error('invalid_grant');
            (err as any).response = { status: 400 };
            throw err;
        };
        await prisma.integrationCredential.update({
            where: { id: credsId },
            data: { expiresAt: new Date(Date.now() - 3600000) }
        });
        await prisma.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED' } });
        
        await EventDispatcher.dispatch(businessId, 'ORDER_CONFIRMED', { orderId });
        
        const integrationAfter4 = await prisma.integration.findUnique({ where: { id: integrationId } });
        assert.strictEqual(integrationAfter4?.status, 'RECONNECT_REQUIRED', 'Integration status should transition to RECONNECT_REQUIRED on invalid_grant');

        console.log('--- ALL TESTS PASSED SUCCESSFULLY ---');
    } catch (e) {
        console.error('TEST FAILED:', e);
        process.exit(1);
    } finally {
        Module.prototype.require = originalRequire; // restore
        await cleanState().catch(() => {});
        await prisma.$disconnect().catch(() => {});
        process.exit(0);
    }
};

runTests();
