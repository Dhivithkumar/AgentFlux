import { normalizeEntityText, AASHA_PRODUCTS } from './aashaKnowledgeData';
import { QueryUnderstandingService } from './QueryUnderstandingService';

const str = "what is the price of the wardrobe with three doors?";
console.log(normalizeEntityText(str));
const output = QueryUnderstandingService.normalizeQuery(str);
console.log(output);
