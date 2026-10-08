import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@agent-flux/database';


const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
    }

    req.user = { id: user.id, email: user.email };
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
};

export const requireBusinessMembership = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let businessId = req.params.businessId || req.query.businessId || req.body.businessId || req.headers['x-business-id'];
    
    if (!businessId && req.baseUrl) {
      const match = req.baseUrl.match(/\/businesses\/([^\/]+)/);
      if (match) businessId = match[1];
    }
    
    if (!businessId && req.originalUrl) {
      const match = req.originalUrl.match(/\/businesses\/([^\/]+)/);
      if (match) businessId = match[1];
    }
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId is required' });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const membership = await prisma.membership.findUnique({
      where: {
        userId_businessId: {
          userId: req.user.id,
          businessId: String(businessId)
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ error: 'Forbidden: You do not have access to this business' });
    }

    // Attach verified businessId to req for safe usage in routes
    (req as any).businessId = businessId;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Internal server error verifying business membership' });
  }
};
