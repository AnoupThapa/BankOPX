# 22 — Glossary

| Term | Meaning |
|---|---|
| **ABAC** | Attribute-based access control (branch, department, portfolio, product, sensitivity, amount, etc.) |
| **AML/CFT** | Anti-money-laundering / countering the financing of terrorism |
| **Authoritative system** | The system that owns a function or record and whose confirmation counts (e.g. CBS for balances) |
| **BBJP** | Branchless Banking Journey Platform |
| **Beneficial owner (BO)** | Natural person who ultimately owns or controls a legal entity |
| **Case** | An application or service request instance with a tracking code and workflow |
| **CBS** | Core banking system |
| **CIB** | Credit information bureau (as applicable to the jurisdiction) |
| **CN / DN** | Bank-specific proposal/note abbreviations. **Meaning differs by bank; never hard-code.** |
| **Customer-wait time** | Interval attributed to waiting for customer information/action |
| **Correlation ID** | Identifier propagated across modules/systems to trace one business operation |
| **DLQ** | Dead-letter queue for messages that exhausted retries |
| **DMS** | Document management system |
| **eKYC** | Electronic know-your-customer process (approved by the bank; legal validity bank-confirmed) |
| **Haircut** | Reduction applied to collateral value under bank-approved rules |
| **Idempotency key** | Client/system-supplied key ensuring a repeated request has one effect |
| **IDOR** | Insecure direct object reference — accessing objects by guessing IDs without authorisation |
| **KYC** | Know your customer |
| **LC** | Letter of credit |
| **Liveness** | Check that a biometric sample comes from a live person (via approved provider) |
| **LMS** | Loan management system |
| **Maker-checker** | Two-person control: one proposes, a different authorised person approves |
| **Margin call** | Notice requiring additional collateral/repayment when coverage falls below policy |
| **MFA** | Multi-factor authentication |
| **NRB** | Nepal Rastra Bank |
| **Outbox** | Pattern writing outbound messages atomically with state changes for reliable delivery |
| **p90 / p95** | 90th/95th percentile |
| **PEP** | Politically exposed person |
| **Pinned version** | The config version (form/workflow/etc.) a case started on and continues to use |
| **Proposal type** | Bank-defined category of credit/service proposal (new, renewal, enhancement, etc.) |
| **RBAC** | Role-based access control |
| **Remote class** | Service attribute: remote-capable / remote-first with conditional attendance / attendance-required |
| **Reconciliation** | Comparing BBJP records with an authoritative system to detect breaks |
| **RPO / RTO** | Recovery point / recovery time objective |
| **SAR** | Suspicious activity report (restricted disclosure) |
| **SLA** | Service-level agreement/target for processing time or availability |
| **Snapshot** | Immutable copy of submitted application data at a point in time |
| **Step-up authentication** | Additional verification before a sensitive action |
| **TAT** | Turnaround time |
| **Tracking code** | Random public locator for a case; not a credential |
| **UAT** | User acceptance testing |
| **Vertical slice** | Thin end-to-end implementation of one service across all layers |
| **Wait party** | Who the elapsed time is attributed to: bank, customer, third party, system |
