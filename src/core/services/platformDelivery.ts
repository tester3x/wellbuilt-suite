import type {createPlatformDeliveryRuntime} from './platformRuntime.generated';
export const platformDelivery=require('../../../modules/wellbuilt-platform/delivery').getDelivery() as ReturnType<typeof createPlatformDeliveryRuntime>;
