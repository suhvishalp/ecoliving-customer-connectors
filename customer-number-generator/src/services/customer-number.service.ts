import type { Customer, CustomerUpdateAction } from '@commercetools/platform-sdk';

/**
 * The rule — the business logic, and nothing else. No Express, no SDK calls, no I/O.
 *
 * WHY AN API EXTENSION, when the email sender next door is a Subscription: a customer number must
 * EXIST on the customer the moment it is saved — the ERP, the invoice and the welcome mail all read it
 * from the first version. A Subscription fires after the save, so there would be a window in which the
 * customer has no number and every consumer has to cope with that. An Extension runs before the save
 * and hands the platform the `setCustomerNumber` action to apply in the same write. The price is the
 * 2-second budget and the coupling: if this service is down, sign-ups are down. See `nextNumber` for
 * how that is kept small, and the controller for what happens when it still fails.
 */
export const DIGITS = 6;

export function formatCustomerNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(DIGITS, '0')}`;
}

export type RuleResult =
  | { actions: CustomerUpdateAction[]; summary: string };

/**
 * `customer` is the customer as it WOULD be saved. A draft that already carries a number — an import,
 * a migration, a Merchant Center user typing one — keeps it: this rule fills a gap, it never overwrites.
 */
export function decide(customer: Pick<Customer, 'customerNumber'>, allocated: string | null): RuleResult {
  if (customer.customerNumber) {
    return { actions: [], summary: `keeps ${customer.customerNumber}` };
  }
  if (allocated === null) {
    return { actions: [], summary: 'no number allocated — approved without one' };
  }
  return { actions: [{ action: 'setCustomerNumber', customerNumber: allocated }], summary: `assigned ${allocated}` };
}
