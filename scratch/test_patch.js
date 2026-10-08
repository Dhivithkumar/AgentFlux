const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "dhivith.off@gmail.com" },
    include: { memberships: true }
  });

  const businessId = user.memberships[0].businessId;
  console.log("Business ID:", businessId);

  // simulate what the backend route does
  const reqBody = {
    businessId: businessId,
    legalBusinessName: "Test Legal Name"
  };

  const updateData = {
    ...(reqBody.legalBusinessName !== undefined && { legalBusinessName: reqBody.legalBusinessName }),
  };

  const result = await prisma.business.update({
    where: { id: businessId },
    data: updateData
  });

  console.log("Update success:", result.legalBusinessName);
}

main().finally(() => prisma.$disconnect());
