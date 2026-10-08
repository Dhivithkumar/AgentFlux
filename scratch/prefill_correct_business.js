const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const businessId = "1379ce47-39e9-4742-9034-dfe218b6c0fc";
  
  console.log("Updating REAL business for this user:", businessId);

  await prisma.business.update({
    where: { id: businessId },
    data: {
      name: "Aasha Furniture",
      legalBusinessName: "Aasha Furniture Pvt Ltd",
      displayName: "Aasha Furniture",
      industry: "Furniture Manufacturing",
      description: "Premium custom furniture manufacturers specializing in modern and traditional designs.",
      
      email: "dhivith.off@gmail.com",
      supportEmail: "support@aashafurniture.com",
      phone: "+91 9876543210",
      alternatePhone: "+91 9876543211",
      website: "https://aashafurniture.com",

      addressLine1: "123 Industrial Estate",
      addressLine2: "Phase 2, Cross Road 4",
      city: "Coimbatore",
      state: "Tamil Nadu",
      postalCode: "641001",
      country: "India",

      taxRegistrationStatus: "REGISTERED",
      gstin: "33AABCU9603R1ZM",
      pan: "AABCU9603R",
      defaultTaxRate: 18.0,

      invoicePrefix: "AF-INV-",
      quotationPrefix: "AF-QUO-",
      orderPrefix: "AF-ORD-",
      defaultPaymentTerms: "50% advance, 50% before delivery",
      defaultInvoiceDueDays: 7,
      invoiceNotes: "Thank you for your business!",
      invoiceFooter: "Aasha Furniture - Quality since 2010",
      quotationFooter: "Quotation valid for 15 days.",

      bankName: "HDFC Bank",
      bankAccountName: "Aasha Furniture Pvt Ltd",
      bankAccountNumber: "50200012345678",
      bankIfsc: "HDFC0001234",
      bankBranch: "Coimbatore Main",
      upiId: "aasha@hdfc",
      paymentInstructions: "Please share the transaction screenshot after payment.",

      authorizedSignatoryName: "Dhivith Kumar",
      authorizedSignatoryDesignation: "Managing Director",
      authorizedSignatoryEmail: "dhivith.off@gmail.com",
      authorizedSignatoryPhone: "+91 9876543210"
    }
  });

  console.log("Sample data injected into the CORRECT business successfully!");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
