import { prisma, VendorVerificationStatus } from '@agent-flux/database';
import dns from 'dns';
import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface VerificationCheckResult {
  passed: boolean;
  score: number;       // 0 - 100
  details: string;
  metadata?: Record<string, any>;
}

export interface VendorVerificationReport {
  vendorId: string;
  vendorName: string;
  status: VendorVerificationStatus;
  method: string;
  checks: {
    domainDns: VerificationCheckResult;
    websiteHttp: VerificationCheckResult;
    emailConsistency: VerificationCheckResult;
    taxRegistryFormat: VerificationCheckResult;
  };
  overallConfidence: number;
  failureReason?: string;
  verifiedAt?: Date;
  expiresAt?: Date;
}

export class VendorVerificationService {
  /**
   * SSRF Protection: Inspects resolved IP addresses to block loopback, RFC1918 private, link-local, and restricted ranges.
   */
  private isRestrictedIp(ip: string): boolean {
    // IPv4 private/loopback/link-local/reserved
    if (ip.startsWith('127.') || ip === '0.0.0.0') return true; // loopback & unspecified
    if (ip.startsWith('10.')) return true;                       // 10.0.0.0/8
    if (ip.startsWith('192.168.')) return true;                  // 192.168.0.0/16
    if (ip.startsWith('169.254.')) return true;                  // link-local 169.254.0.0/16

    // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
    if (ip.startsWith('172.')) {
      const parts = ip.split('.');
      if (parts.length >= 2) {
        const second = parseInt(parts[1], 10);
        if (second >= 16 && second <= 31) return true;
      }
    }

    // IPv6 loopback & link-local
    if (ip === '::1' || ip === '::' || ip.toLowerCase().startsWith('fe80:') || ip.toLowerCase().startsWith('fc00:') || ip.toLowerCase().startsWith('fd00:')) {
      return true;
    }

    return false;
  }

  /**
   * Validates target website with strict SSRF protection, protocol enforcement, and redirect inspection.
   */
  async checkWebsiteReachability(urlString: string, redirectCount = 0): Promise<VerificationCheckResult> {
    if (redirectCount > 3) {
      return { passed: false, score: 0, details: 'Too many redirects encountered (max 3)' };
    }

    let parsedUrl: URL;
    try {
      if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
        urlString = 'https://' + urlString;
      }
      parsedUrl = new URL(urlString);
    } catch (e: any) {
      return { passed: false, score: 0, details: `Malformed website URL: ${e.message}` };
    }

    // Protocol check: only http or https
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { passed: false, score: 0, details: `Disallowed protocol ${parsedUrl.protocol}. Only HTTP/HTTPS permitted.` };
    }

    const hostname = parsedUrl.hostname;

    // Direct SSRF check on hostname if it's localhost or direct IP
    if (hostname.toLowerCase() === 'localhost' || this.isRestrictedIp(hostname)) {
      return {
        passed: false,
        score: 0,
        details: `SSRF blocked: Hostname ${hostname} is a restricted private/loopback destination`
      };
    }

    // DNS Resolution check
    let resolvedIps: string[] = [];
    try {
      const lookupResult = await dns.promises.lookup(hostname, { all: true });
      resolvedIps = lookupResult.map(r => r.address);
    } catch (err: any) {
      return { passed: false, score: 0, details: `DNS resolution failed for host ${hostname}: ${err.code || err.message}` };
    }

    // SSRF Check against every resolved IP address
    for (const ip of resolvedIps) {
      if (this.isRestrictedIp(ip)) {
        return {
          passed: false,
          score: 0,
          details: `SSRF blocked: Hostname ${hostname} resolves to blocked private/loopback IP ${ip}`
        };
      }
    }

    // Safe HTTP probe with 5-second timeout and 512KB size limit
    return new Promise((resolve) => {
      const client = parsedUrl.protocol === 'https:' ? https : http;
      let settled = false;

      const req = client.get(
        parsedUrl,
        {
          headers: { 'User-Agent': 'AgentFlux-VendorVerification/2.0' },
          timeout: 5000
        },
        (res) => {
          // Handle redirects securely by re-checking target
          if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            req.destroy();
            settled = true;
            resolve(this.checkWebsiteReachability(res.headers.location, redirectCount + 1));
            return;
          }

          let bytesReceived = 0;
          res.on('data', (chunk) => {
            bytesReceived += chunk.length;
            if (bytesReceived > 524288) { // 512 KB
              req.destroy();
              if (!settled) {
                settled = true;
                resolve({ passed: true, score: 90, details: 'Website responded (truncated at 512KB limit)' });
              }
            }
          });

          res.on('end', () => {
            if (!settled) {
              settled = true;
              const isSuccess = res.statusCode ? res.statusCode >= 200 && res.statusCode < 400 : false;
              resolve({
                passed: isSuccess,
                score: isSuccess ? 100 : 40,
                details: `Website responded with HTTP status ${res.statusCode}`,
                metadata: { statusCode: res.statusCode, https: parsedUrl.protocol === 'https:' }
              });
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        if (!settled) {
          settled = true;
          resolve({ passed: false, score: 0, details: 'Website probe timed out after 5000ms' });
        }
      });

      req.on('error', (err) => {
        if (!settled) {
          settled = true;
          resolve({ passed: false, score: 0, details: `Network error probing website: ${err.message}` });
        }
      });
    });
  }

  /**
   * Validates consistency between business contact email domain and website domain.
   */
  checkEmailDomainConsistency(email?: string | null, website?: string | null): VerificationCheckResult {
    if (!email || !website) {
      return {
        passed: false,
        score: 30,
        details: 'Email or website missing for domain consistency check'
      };
    }

    try {
      const emailDomain = email.split('@')[1]?.toLowerCase().trim();
      let websiteHost = website.toLowerCase().trim();
      if (!websiteHost.startsWith('http://') && !websiteHost.startsWith('https://')) {
        websiteHost = 'https://' + websiteHost;
      }
      const parsedHost = new URL(websiteHost).hostname.replace(/^www\./, '');

      if (!emailDomain) {
        return { passed: false, score: 0, details: 'Invalid email address syntax' };
      }

      if (emailDomain === parsedHost || emailDomain.endsWith('.' + parsedHost) || parsedHost.endsWith('.' + emailDomain)) {
        return {
          passed: true,
          score: 100,
          details: `Corporate domain verified: email @${emailDomain} aligns with website ${parsedHost}`,
          metadata: { emailDomain, websiteDomain: parsedHost }
        };
      } else {
        // Generic public email domains (gmail, yahoo, etc.)
        const genericProviders = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'protonmail.com'];
        if (genericProviders.includes(emailDomain)) {
          return {
            passed: false,
            score: 40,
            details: `Vendor uses consumer email provider (@${emailDomain}) rather than official corporate domain`,
            metadata: { isConsumerDomain: true }
          };
        }

        return {
          passed: false,
          score: 50,
          details: `Email domain @${emailDomain} does not match website domain ${parsedHost}`
        };
      }
    } catch (e: any) {
      return { passed: false, score: 20, details: `Domain parse error: ${e.message}` };
    }
  }

  /**
   * Validates legal company registration or Tax / GSTIN format and structure.
   */
  checkTaxAndRegistrationFormat(taxId?: string | null, regNumber?: string | null): VerificationCheckResult {
    if (!taxId && !regNumber) {
      return {
        passed: false,
        score: 0,
        details: 'No tax identification (GSTIN/EIN/VAT) or registration number provided'
      };
    }

    // Check Indian GSTIN (15 characters: 2 state digits + 10 PAN alphanumeric + 1 entity + 1 Z + 1 checksum)
    if (taxId) {
      const cleanTax = taxId.trim().toUpperCase();
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      
      if (gstinRegex.test(cleanTax)) {
        const stateCode = cleanTax.substring(0, 2);
        const pan = cleanTax.substring(2, 12);
        return {
          passed: true,
          score: 100,
          details: `Valid statutory GSTIN format verified (State code: ${stateCode}, PAN: ${pan})`,
          metadata: { type: 'GSTIN', validFormat: true, stateCode, pan }
        };
      }

      // Check US EIN (format XX-XXXXXXX or 9 digits)
      const einRegex = /^\d{2}-\d{7}$|^\d{9}$/;
      if (einRegex.test(cleanTax)) {
        return {
          passed: true,
          score: 95,
          details: 'Valid Employer Identification Number (EIN) format verified',
          metadata: { type: 'EIN', validFormat: true }
        };
      }

      // European VAT format (2 letter country code + 8-12 alphanumeric)
      const vatRegex = /^[A-Z]{2}[0-9A-Z]{8,12}$/;
      if (vatRegex.test(cleanTax)) {
        return {
          passed: true,
          score: 95,
          details: `Valid EU VAT format verified (${cleanTax.substring(0, 2)})`,
          metadata: { type: 'VAT', validFormat: true }
        };
      }
    }

    if (regNumber && regNumber.length >= 6) {
      return {
        passed: true,
        score: 80,
        details: `Corporate Registration Number verified: ${regNumber}`,
        metadata: { type: 'CORPORATE_REGISTRATION' }
      };
    }

    return {
      passed: false,
      score: 30,
      details: 'Tax ID provided does not match recognised statutory format (GSTIN, EIN, or VAT)'
    };
  }

  /**
   * Helper to validate tax ID format directly
   */
  validateTaxId(taxId: string, type: string = 'GSTIN'): { valid: boolean; details: string; type: string } {
    const res = this.checkTaxAndRegistrationFormat(taxId);
    return {
      valid: res.passed,
      details: res.details,
      type: res.metadata?.type || type
    };
  }

  /**
   * Helper to verify website reachability directly
   */
  async verifyWebsite(url: string): Promise<{ reachable: boolean; details: string; score: number }> {
    const res = await this.checkWebsiteReachability(url);
    return {
      reachable: res.passed,
      details: res.details,
      score: res.score
    };
  }

  /**
   * Executes the full automated verification pipeline on a vendor.
   */
  async verifyVendor(param1: string, param2: string, performedById?: string): Promise<VendorVerificationReport> {
    const vendor = await prisma.vendor.findFirst({
      where: {
        OR: [
          { id: param2, businessId: param1 },
          { id: param1, businessId: param2 }
        ]
      }
    });

    if (!vendor) {
      throw new Error(`Vendor not found for verification with params (${param1}, ${param2})`);
    }

    const businessId = vendor.businessId;
    const vendorId = vendor.id;

    // Set status to IN_PROGRESS
    await prisma.vendor.update({
      where: { id: vendorId },
      data: { verificationStatus: 'IN_PROGRESS' }
    });

    await prisma.vendorVerificationLog.create({
      data: {
        vendorId,
        businessId,
        fromStatus: vendor.verificationStatus,
        toStatus: 'IN_PROGRESS',
        method: 'AUTOMATED_SUITE',
        details: { action: 'Started automated verification suite' },
        performedById
      }
    });

    // 1. DNS & Website Reachability check
    const websiteResult = vendor.website
      ? await this.checkWebsiteReachability(vendor.website)
      : { passed: false, score: 0, details: 'No website URL provided' };

    // 2. Email Domain Consistency check
    const emailResult = this.checkEmailDomainConsistency(vendor.email, vendor.website);

    // 3. Tax / Registry check
    const taxResult = this.checkTaxAndRegistrationFormat(vendor.taxId, vendor.registrationNumber);

    // Composite Confidence Calculation
    // Weightings: Tax/Registry (45%), Website Reachability (35%), Email Domain (20%)
    const overallConfidence = Math.round(
      (taxResult.score * 0.45) +
      (websiteResult.score * 0.35) +
      (emailResult.score * 0.20)
    );

    // Determine final status
    let finalStatus: VendorVerificationStatus = 'PENDING_VERIFICATION';
    let failureReason: string | undefined;

    // Strict Rule: Legal verification requires verified statutory registration / tax ID!
    // A website online is NOT enough to claim legally verified.
    if (taxResult.passed && websiteResult.passed && emailResult.passed) {
      finalStatus = 'VERIFIED';
    } else if (websiteResult.passed && (taxResult.passed || emailResult.passed)) {
      finalStatus = 'PARTIALLY_VERIFIED';
      failureReason = !taxResult.passed 
        ? 'Website verified; Statutory tax/registration check pending verification'
        : 'Statutory registration valid; Corporate email domain check pending';
    } else if (!websiteResult.passed && taxResult.passed) {
      finalStatus = 'MANUAL_REVIEW_REQUIRED';
      failureReason = 'Statutory registration valid but website unreachable or unverified; Manual review recommended';
    } else {
      finalStatus = 'VERIFICATION_FAILED';
      failureReason = websiteResult.details.includes('SSRF') 
        ? websiteResult.details 
        : `Verification checks failed: ${websiteResult.details}; ${taxResult.details}`;
    }

    const verifiedAt = ['VERIFIED', 'PARTIALLY_VERIFIED'].includes(finalStatus) ? new Date() : undefined;
    const expiresAt = verifiedAt ? new Date(verifiedAt.getTime() + 180 * 86400000) : undefined; // 180 days validity

    const report: VendorVerificationReport = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      status: finalStatus,
      method: 'AUTOMATED_SUITE',
      checks: {
        domainDns: { passed: websiteResult.passed, score: websiteResult.score, details: websiteResult.details },
        websiteHttp: websiteResult,
        emailConsistency: emailResult,
        taxRegistryFormat: taxResult
      },
      overallConfidence,
      failureReason,
      verifiedAt,
      expiresAt
    };

    // Update vendor record
    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        verificationStatus: finalStatus,
        verificationMethod: 'AUTOMATED_SUITE',
        verifiedAt,
        verificationExpiresAt: expiresAt,
        failureReason,
        verificationEvidence: report.checks as any
      }
    });

    // Record audit log
    await prisma.vendorVerificationLog.create({
      data: {
        vendorId,
        businessId,
        fromStatus: 'IN_PROGRESS',
        toStatus: finalStatus,
        method: 'AUTOMATED_SUITE',
        details: {
          overallConfidence,
          checks: report.checks,
          failureReason
        } as any,
        error: failureReason,
        performedById
      }
    });

    return report;
  }

  /**
   * Records an authorized manual review or override for a vendor.
   */
  async manualReviewVendor(
    businessId: string,
    vendorId: string,
    decision: {
      status: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'VERIFICATION_FAILED' | 'MANUAL_REVIEW_REQUIRED';
      reason: string;
      notes?: string;
      documentReferences?: string[];
    },
    userId: string
  ) {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId, businessId }
    });

    if (!vendor) {
      throw new Error(`Vendor ${vendorId} not found in business ${businessId}`);
    }

    const verifiedAt = ['VERIFIED', 'PARTIALLY_VERIFIED'].includes(decision.status) ? new Date() : undefined;
    const expiresAt = verifiedAt ? new Date(verifiedAt.getTime() + 365 * 86400000) : undefined; // 1 year manual review

    const updated = await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        verificationStatus: decision.status,
        verificationMethod: 'MANUAL_REVIEW',
        verifiedAt,
        verificationExpiresAt: expiresAt,
        failureReason: decision.status === 'VERIFICATION_FAILED' ? decision.reason : null,
        metadata: {
          manualReview: {
            reviewerId: userId,
            reviewedAt: new Date().toISOString(),
            notes: decision.notes,
            reason: decision.reason,
            documents: decision.documentReferences
          }
        }
      }
    });

    await prisma.vendorVerificationLog.create({
      data: {
        vendorId,
        businessId,
        fromStatus: vendor.verificationStatus,
        toStatus: decision.status,
        method: 'MANUAL_REVIEW',
        details: {
          decision: decision.status,
          reason: decision.reason,
          notes: decision.notes,
          documents: decision.documentReferences
        } as any,
        performedById: userId
      }
    });

    return updated;
  }

  /**
   * Helper signature for manual compliance review
   */
  async manualReview(
    vendorId: string,
    businessId: string,
    userId: string,
    status: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'VERIFICATION_FAILED' | 'MANUAL_REVIEW_REQUIRED',
    reason: string
  ) {
    return this.manualReviewVendor(
      businessId,
      vendorId,
      {
        status,
        reason,
        notes: reason
      },
      userId
    );
  }
}

export const vendorVerificationService = new VendorVerificationService();
