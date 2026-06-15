import type { LegalDocs } from '../types';

const LANG_PRIORITY =
  'In case of any discrepancy between the Russian version of this document and its translations into other languages, the Russian version shall prevail unless expressly stated otherwise by the Provider.';

export const legalDocs: LegalDocs = {
  offer: {
    slug: 'offer',
    title: 'Public Offer Agreement',
    metaTitle: 'Public Offer — WPO Translations',
    metaDescription: 'Public Offer Agreement for translation services provided by WPO Translations. Service levels, pricing, payment, and cancellation terms.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'provider',
        heading: '1. Provider Details',
        body: [
          'This Public Offer Agreement (hereinafter "Agreement") is published by WorldPrimeOnline (hereinafter "Provider").',
          'Provider: IE WorldPrimeOnline',
          'IIN/BIN: 840324300155',
          'Address: Almaty, Kazybek bi st. 139/1',
          'Email: worldprimeonline@gmail.com',
          'Phone: +7 707 222 28 58',
          'Website: https://www.wpotranslations.org/',
          'VAT: not applicable',
          'Publication date: 2026-05-26',
          'This Agreement constitutes a public offer under applicable law. By placing an order on the Platform, the Customer accepts all terms of this Agreement in full.',
        ],
      },
      {
        id: 'definitions',
        heading: '2. Definitions',
        body: [
          '• "Customer" — any individual or legal entity who places an order through the Platform.',
          '• "Service" — document translation services provided by the Provider.',
          '• "Electronic Translation" — a translation delivered in electronic format without translator signature, Provider stamp, or notarization, unless otherwise selected by the Customer.',
          '• "Official Translation" — a translation reviewed by a human translator, containing the translator\'s signature and Provider stamp, available as a separately selected and paid option.',
          '• "Notarization" — a certification process arranged with a qualified translator and/or partner notary where such a service is available. Notarization is not automatic and is arranged separately.',
          '• "Platform" — the website and services accessible at https://www.wpotranslations.org/.',
          '• "Order" — a request for a translation submitted by the Customer through the Platform.',
          '• "Translated Document" — the output PDF file delivered to the Customer upon completion of the Service.',
        ],
      },
      {
        id: 'subject',
        heading: '3. Subject of the Agreement',
        body: [
          'The Provider agrees to provide document translation services in accordance with the service level selected by the Customer. The Customer agrees to accept and pay for such services in accordance with the terms of this Agreement.',
          'The Platform uses AI-assisted processing (optical character recognition and machine translation) as part of its workflow. Human translator involvement is available only where explicitly selected and confirmed at the time of order.',
        ],
      },
      {
        id: 'service-levels',
        heading: '4. Service Levels',
        body: [
          '4.1 Electronic Translation. The Provider translates the uploaded document using AI-assisted OCR and machine translation tools. The output is delivered as a PDF file. This level does not include translator signature, Provider stamp, or notarization. Intended for informational, review, and preparatory purposes.',
          '4.2 Official Translation (where available). The translation is reviewed by a human translator. The output includes the translator\'s signature and Provider stamp. This option must be explicitly selected by the Customer at the time of order and is subject to availability confirmation by the Provider.',
          '4.3 Notarization (where available). An additional certification process arranged by the Provider with a certified translator and/or partner notary. Availability depends on the jurisdiction and partner network. This service is not automatically included and must be arranged separately. The Provider does not guarantee notarization in all cases.',
        ],
      },
      {
        id: 'order-process',
        heading: '5. Order Process',
        body: [
          'To place an order, the Customer must: (1) register on the Platform or use an existing account; (2) upload the source document in PDF format; (3) select the source language, target language, and document type; (4) select the desired service level; (5) confirm the order and complete payment.',
          'An order is considered accepted by the Provider upon receipt of confirmed payment. The Provider reserves the right to reject an order if the uploaded document does not meet quality requirements or violates these terms.',
        ],
      },
      {
        id: 'customer-obligations',
        heading: '6. Customer Obligations',
        body: [
          'The Customer agrees to:',
          '• Upload only documents to which the Customer holds the right to request translation.',
          '• Provide accurate information about document type, language, and intended use.',
          '• Not use the Service for fraudulent, deceptive, or illegal purposes.',
          '• Verify with the intended receiving organization whether the Service output meets their specific requirements before relying on the Translated Document for official purposes.',
          '• Not hold the Provider liable for rejection of the Translated Document by any third party.',
        ],
      },
      {
        id: 'provider-obligations',
        heading: '7. Provider Obligations',
        body: [
          'The Provider agrees to:',
          '• Provide the Service in accordance with the selected service level.',
          '• Deliver the Translated Document within the timeframe stated on the Platform.',
          '• Ensure secure storage of uploaded files in accordance with the Privacy Policy.',
          '• Process personal data only for the purposes stated in the Privacy Policy.',
          '• Notify the Customer of any material changes to the terms of this Agreement.',
        ],
      },
      {
        id: 'pricing',
        heading: '8. Pricing and Price Determination',
        body: [
          'Prices for the Service are determined by the Provider and published on the Platform at the time of order. The Provider reserves the right to change prices without prior notice, provided that any price change does not affect orders that have already been paid.',
          'The price for Electronic Translation depends on the document type selected by the Customer. Additional fees apply to Official Translation and Notarization where these options are selected.',
          'All prices are shown inclusive of any applicable taxes unless otherwise indicated.',
        ],
      },
      {
        id: 'payment',
        heading: '9. Payment Terms',
        body: [
          'Payment must be completed before the Provider begins processing the order. Available payment methods are shown at checkout.',
          'The Provider uses third-party payment processing services. By completing a payment, the Customer agrees to the terms of the relevant payment provider.',
          'The Customer is responsible for any transaction fees charged by the Customer\'s bank or payment provider.',
        ],
      },
      {
        id: 'fiscal',
        heading: '10. Fiscal Receipts',
        body: [
          'Where required by applicable law, the Provider issues fiscal receipts or equivalent payment confirmations for completed payments.',
          'Customers may request a copy of their payment confirmation through the Platform account or by contacting the Provider at worldprimeonline@gmail.com.',
        ],
      },
      {
        id: 'cancellation',
        heading: '11. Cancellation and Refund Rules',
        body: [
          '11.1 Before processing begins. The Customer may cancel an order and receive a full refund if cancellation is requested before the Provider begins processing the document. Once processing has started, cancellation may not be possible.',
          '11.2 After processing begins. Processing may begin automatically immediately after payment confirmation and order creation. Once OCR, AI processing, translation, PDF generation, or transfer to a translator or notary partner has commenced, order cancellation may not be possible. No refund is issued except as provided in clause 11.3.',
          '11.3 Technical errors. If the Translated Document cannot be delivered or is delivered demonstrably incomplete or corrupted due to a technical error on the Provider\'s side, the Provider may perform reprocessing at no additional charge. A refund is provided if reprocessing is not possible, does not resolve the technical error, or the Translated Document cannot be delivered due to the Provider\'s fault.',
          '11.4 Poor document quality. The Provider is not responsible for translation quality where the source document is illegible, heavily damaged, or of insufficient scan quality for accurate OCR extraction. In such cases, no refund is issued.',
          '11.5 Incorrect input. The Provider is not responsible for incorrect translation output resulting from incorrect document type, language selection, or other erroneous input by the Customer.',
          '11.6 Refund method. Refunds are processed through the same payment method used for the original transaction, within 10 business days of approval.',
        ],
      },
      {
        id: 'ai-disclosure',
        heading: '12. AI-Assisted Processing Disclosure',
        body: [
          'The Service uses artificial intelligence tools for optical character recognition (OCR) and machine translation. While the Provider takes measures to ensure quality, AI-generated translations may contain errors, omissions, or imprecisions.',
          'The Electronic Translation service level does not involve human review. Customers requiring human review must select the Official Translation service level where available.',
          'The Provider does not warrant that the translation output is free from error or meets the requirements of any particular institution, authority, or organization.',
        ],
      },
      {
        id: 'translator',
        heading: '13. Translator Involvement',
        body: [
          'Human translator involvement is only provided at the Official Translation service level. At this level, a qualified translator reviews the AI-generated output, makes corrections where necessary, and applies their signature and the Provider stamp to the document.',
          'Translator availability and language pairs for the Official Translation level are subject to availability and are confirmed at the time of order.',
        ],
      },
      {
        id: 'notarization',
        heading: '14. Notarization Through Partners',
        body: [
          'The Provider may offer notarization through certified translator and notary partners in certain jurisdictions. This service is not available for all document types, language pairs, or regions.',
          'Notarization is arranged separately, subject to partner availability, and may carry additional fees. The Provider does not guarantee that notarization will be available for any given order.',
          'Notarized translations produced through this process are subject to the terms and applicable professional standards of the certifying translator or notary.',
        ],
      },
      {
        id: 'no-guarantee',
        heading: '15. No Guarantee of Third-Party Acceptance',
        body: [
          'The Provider does not guarantee that the Translated Document will be accepted by any embassy, consulate, immigration authority, bank, university, notary, court, or other organization.',
          'Requirements for translation format, certification level, and document presentation vary by institution and jurisdiction. The Customer is solely responsible for verifying the requirements of the intended recipient before relying on the Translated Document.',
          'The Provider expressly disclaims any liability for rejection of the Translated Document by any third party.',
        ],
      },
      {
        id: 'liability',
        heading: '16. Limitation of Liability',
        body: [
          'To the maximum extent permitted by applicable law, the Provider\'s total liability to the Customer for any claim arising from or related to this Agreement shall not exceed the amount paid by the Customer for the specific order giving rise to the claim.',
          'The Provider is not liable for any indirect, incidental, consequential, or special damages, including loss of documents, loss of opportunity, or reputational harm.',
          'The Provider is not liable for delays or failure to perform resulting from circumstances beyond its reasonable control.',
        ],
      },
      {
        id: 'personal-data',
        heading: '17. Personal Data',
        body: [
          'The Provider processes personal data of the Customer in accordance with the Privacy Policy published at https://www.wpotranslations.org/legal/privacy.',
          'By accepting this Agreement, the Customer consents to the processing of their personal data for the purposes of providing the Service, processing payments, and communicating about the order.',
        ],
      },
      {
        id: 'storage',
        heading: '18. Document Storage and Deletion',
        body: [
          'Uploaded documents and Translated Documents are stored on the Provider\'s servers for a maximum of 30 days from the date of translation completion.',
          'After 30 days, all files are automatically and permanently deleted. The Customer may request earlier deletion through the Platform account settings or by contacting worldprimeonline@gmail.com.',
        ],
      },
      {
        id: 'lang-priority',
        heading: '19. Language Priority',
        body: [LANG_PRIORITY],
      },
      {
        id: 'disputes',
        heading: '20. Dispute Resolution',
        body: [
          'Any dispute arising from or related to this Agreement shall first be subject to pre-trial resolution. The Customer shall submit a written claim to the Provider at worldprimeonline@gmail.com. The Provider shall respond within 30 calendar days.',
          'If the dispute cannot be resolved amicably, it shall be submitted to the competent court at the Provider\'s registered address, in accordance with applicable law.',
        ],
      },
      {
        id: 'contact',
        heading: '21. Contact Details',
        body: [
          'Provider: IE WorldPrimeOnline',
          'Address: Almaty, Kazybek bi st. 139/1',
          'Email: worldprimeonline@gmail.com',
          'Website: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  privacy: {
    slug: 'privacy',
    title: 'Privacy Policy',
    metaTitle: 'Privacy Policy — WPO Translations',
    metaDescription: 'How WPO Translations collects, processes, stores, and protects your personal data. Data retention, deletion, and your rights.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'controller',
        heading: '1. Data Controller',
        body: [
          'This Privacy Policy describes how WorldPrimeOnline (hereinafter "Provider") processes personal data when you use the Platform at https://www.wpotranslations.org/.',
          'Provider: IE WorldPrimeOnline',
          'IIN/BIN: 840324300155',
          'Address: Almaty, Kazybek bi st. 139/1',
          'Email: worldprimeonline@gmail.com',
          'Phone: +7 707 222 28 58',
          'Website: https://www.wpotranslations.org/',
        ],
      },
      {
        id: 'data-types',
        heading: '2. Types of Personal Data Processed',
        body: [
          'The Provider processes the following categories of personal data:',
          '• Account information: email address provided at registration.',
          '• Uploaded documents: PDF files submitted for translation. These may contain personal data such as name, date of birth, document numbers, address, financial data, or medical information depending on document type.',
          '• Translation output: the translated PDF files generated by the Service.',
          '• Payment data: transaction identifiers and payment amounts. The Provider does not store payment card numbers or payment credentials.',
          '• IP address and technical metadata: the client IP address is collected at the time of document upload or payment order creation. This data is used exclusively for security, fraud prevention, payment order confirmation, and dispute/chargeback handling as required by the payment service provider (acquirer). IP addresses are not shared with third parties for marketing purposes and are not displayed to other users.',
          '• Usage data: timestamps, document types, language pairs, session identifiers, and basic technical logs used to operate and improve the Service.',
        ],
      },
      {
        id: 'purpose',
        heading: '3. Purpose of Processing',
        body: [
          'Personal data is processed exclusively for the following purposes:',
          '• Providing the document translation service requested by the Customer.',
          '• Processing and verifying payments.',
          '• Delivering the Translated Document and associated service notifications.',
          '• Responding to Customer support requests.',
          '• Improving the accuracy and reliability of the Service.',
          '• Fraud prevention, security monitoring, and payment dispute/chargeback handling.',
          '• Complying with applicable legal obligations, including requirements of the payment service provider (acquirer).',
        ],
      },
      {
        id: 'legal-basis',
        heading: '4. Legal Basis for Processing',
        body: [
          'Processing is carried out on the basis of the Customer\'s consent (provided at the time of registration and order placement), performance of the contract between the Customer and the Provider, and the Provider\'s legitimate interests in operating and improving the Service.',
          'Where required by law, additional consent is obtained before processing special categories of personal data.',
        ],
      },
      {
        id: 'storage',
        heading: '5. Storage Period and 30-Day File Retention',
        body: [
          'Uploaded source documents and Translated Documents are automatically and permanently deleted 30 days after the translation is completed.',
          'Account information is retained until the Customer deletes their account.',
          'Payment records are retained as required by applicable financial and tax regulations.',
          'Usage logs are retained for a maximum of 12 months.',
        ],
      },
      {
        id: 'deletion',
        heading: '6. Deletion Request',
        body: [
          'The Customer may request immediate deletion of their uploaded files before the 30-day retention period expires. Deletion requests can be submitted through the Platform account settings or by contacting worldprimeonline@gmail.com.',
          'Account deletion requests will result in the permanent deletion of all personal data associated with the account, subject to mandatory retention obligations.',
        ],
      },
      {
        id: 'third-parties',
        heading: '7. Third-Party Processors',
        body: [
          'The Provider uses the following sub-processors to operate the Service:',
          '• Supabase — database and authentication infrastructure.',
          '• Cloudflare R2 — encrypted file storage.',
          '• Mistral AI — optical character recognition (OCR) for extracting text from PDF files.',
          '• Anthropic — AI translation processing.',
          '• Resend — email notification delivery.',
          '• Atlassian (Jira Cloud) — operational management of official and notarized translation orders.',
          '• Sentry — error monitoring (anonymized technical data only).',
          '• Where the Official Translation or Notarization service level is selected, relevant document data may be shared with assigned translators, notaries, and other partners involved in providing the respective service, solely to the extent necessary to fulfil the order.',
          'All sub-processors are bound by data processing agreements and are prohibited from using Customer data for purposes other than providing the contracted service.',
        ],
      },
      {
        id: 'security',
        heading: '8. Security Measures',
        body: [
          'Uploaded documents and Translated Documents are stored with encryption at rest. Data in transit is protected by TLS. Access to documents is restricted to the authenticated Customer account.',
          'The Provider implements technical and organizational security measures appropriate to the risk of the data processed.',
        ],
      },
      {
        id: 'cross-border',
        heading: '9. Cross-Border Data Transfer',
        body: [
          'Some sub-processors may process data outside the country of the Customer\'s residence. Where such transfers occur, the Provider ensures appropriate safeguards are in place in accordance with applicable data protection law.',
        ],
      },
      {
        id: 'rights',
        heading: '10. Your Rights',
        body: [
          'Subject to applicable law, the Customer has the right to:',
          '• Access the personal data the Provider holds about them.',
          '• Correct inaccurate personal data.',
          '• Request deletion of personal data (subject to legal retention obligations).',
          '• Object to or restrict processing in certain circumstances.',
          '• Withdraw consent at any time without affecting the lawfulness of prior processing.',
          'To exercise these rights, contact the Provider at worldprimeonline@gmail.com. Requests will be addressed within 30 calendar days.',
        ],
      },
      {
        id: 'cookies',
        heading: '11. Cookies',
        body: [
          'The Provider uses only essential cookies required for authentication (managed by Supabase) and locale preference storage (NEXT_LOCALE cookie). No advertising or cross-site tracking cookies are used.',
        ],
      },
      {
        id: 'changes',
        heading: '12. Changes to This Policy',
        body: [
          'The Provider may update this Privacy Policy. Significant changes will be communicated by email or by a notice on the Platform. Continued use of the Service after the effective date of changes constitutes acceptance of the updated Policy.',
        ],
      },
      {
        id: 'lang-priority',
        heading: '13. Language Priority',
        body: [LANG_PRIORITY],
      },
      {
        id: 'contact',
        heading: '14. Contact',
        body: [
          'Provider: IE WorldPrimeOnline',
          'Address: Almaty, Kazybek bi st. 139/1',
          'Contact: worldprimeonline@gmail.com',
          'Website: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  'personal-data-consent': {
    slug: 'personal-data-consent',
    title: 'Personal Data Processing Consent',
    metaTitle: 'Personal Data Consent — WPO Translations',
    metaDescription: 'Consent to the processing of personal data when using WPO Translations services.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'intro',
        heading: '1. Who This Consent Applies To',
        body: [
          'This document describes the consent provided by the Customer to WorldPrimeOnline (hereinafter "Provider"), for the processing of personal data in connection with the use of the document translation service at https://www.wpotranslations.org/.',
        ],
      },
      {
        id: 'what-data',
        heading: '2. Personal Data Subject to Processing',
        body: [
          'By using the Service, the Customer consents to the processing of:',
          '• Email address provided at registration.',
          '• The content of uploaded documents. Depending on the document type, uploaded files may contain personal data including: full name, date of birth, passport or ID number, address, nationality, financial account details, employment information, medical data, or other personal information.',
          '• Translation output files containing the above data in the target language.',
          '• Payment transaction data (identifiers and amounts; no payment card credentials are stored).',
          '• IP address collected at the time of document upload or payment order creation, used for security, fraud prevention, and dispute/chargeback handling.',
          '• Usage metadata (timestamps, document type, language pairs).',
        ],
      },
      {
        id: 'purpose',
        heading: '3. Purpose of Processing',
        body: [
          'Personal data is processed for the following purposes:',
          '• Providing the requested translation service.',
          '• Processing and verifying payment.',
          '• Delivering translated documents and service notifications.',
          '• Customer support.',
          '• Improving Service quality and accuracy.',
          '• Compliance with applicable legal obligations.',
        ],
      },
      {
        id: 'transfer',
        heading: '4. Transfer to Processors and Partners',
        body: [
          'The Provider may transfer personal data to third-party processors (Supabase, Cloudflare R2, Mistral AI, Anthropic, Resend, Atlassian) for the sole purpose of providing the Service. Where the Official Translation or Notarization service level is selected, relevant document data may be shared with the assigned translator or notary partner.',
          'All processors are prohibited from using the data for any purpose other than providing the contracted service.',
        ],
      },
      {
        id: 'retention',
        heading: '5. Retention and Deletion',
        body: [
          'Uploaded source documents and translated files are automatically and permanently deleted 30 days after translation completion.',
          'Account data is retained until account deletion is requested.',
          'The Customer may request earlier deletion at any time via the Platform account settings or by contacting worldprimeonline@gmail.com.',
        ],
      },
      {
        id: 'withdrawal',
        heading: '6. Withdrawal of Consent',
        body: [
          'The Customer may withdraw consent at any time by deleting their account or contacting the Provider at worldprimeonline@gmail.com. Withdrawal of consent does not affect the lawfulness of processing carried out before the withdrawal.',
          'Withdrawal of consent may prevent the Customer from using certain features of the Service.',
        ],
      },
      {
        id: 'lang-priority',
        heading: '7. Language Priority',
        body: [LANG_PRIORITY],
      },
    ],
  },

  'refund-policy': {
    slug: 'refund-policy',
    title: 'Cancellation, Refund and Reprocessing Policy',
    metaTitle: 'Refund Policy — WPO Translations',
    metaDescription: 'WPO Translations refund, cancellation, and reprocessing rules. When refunds are available and how to request them.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'before-processing',
        heading: '1. Cancellation Before Processing Begins',
        body: [
          'The Customer may cancel an order and receive a full refund if the cancellation request is submitted before the Provider begins processing the uploaded document.',
          'Processing may begin automatically immediately after payment confirmation and order creation. Once OCR, AI processing, translation, PDF generation, or transfer to a translator or notary partner has commenced, order cancellation may not be possible.',
          'To cancel, the Customer should contact the Provider at worldprimeonline@gmail.com as soon as possible after placing the order.',
        ],
      },
      {
        id: 'after-processing',
        heading: '2. No Refund After Processing Begins',
        body: [
          'Once the Provider begins processing the document (OCR, translation, PDF generation, or transfer to a translator or notary partner), no refund is issued except as provided in section 3.',
          'Dissatisfaction with translation quality, style, or terminology — where the source document was legible and the order inputs were correctly entered — does not entitle the Customer to a refund.',
        ],
      },
      {
        id: 'reprocessing',
        heading: '3. Reprocessing for Technical Errors',
        body: [
          'If the Translated Document cannot be delivered or is delivered demonstrably incomplete or corrupted due to a technical error on the Provider\'s side, the Provider may perform reprocessing at no additional charge.',
          'A refund is provided if reprocessing is not possible, does not resolve the technical error, or the Translated Document cannot be delivered due to the Provider\'s fault.',
          'Requests must be submitted within 7 days of document delivery by contacting worldprimeonline@gmail.com with a description of the issue and the order reference.',
        ],
      },
      {
        id: 'poor-scan',
        heading: '4. Poor Scan or File Quality',
        body: [
          'The Provider\'s OCR and translation pipeline requires legible source documents. If the uploaded file is of insufficient quality for accurate text extraction (e.g., blurred scan, rotated pages, heavy watermarks, or handwritten content), the translation output may be incomplete or inaccurate.',
          'In such cases, no refund or reprocessing is automatically provided. The Customer is encouraged to review the file quality before ordering.',
        ],
      },
      {
        id: 'incorrect-input',
        heading: '5. Incorrect Customer Input',
        body: [
          'The Provider is not responsible for translation errors resulting from incorrect information entered by the Customer at the time of order, including incorrect source language, target language, or document type selection.',
          'No refund is issued for orders where the output correctly reflects the input parameters provided by the Customer.',
        ],
      },
      {
        id: 'partner-services',
        heading: '6. Official Translation and Notarization Refunds',
        body: [
          'Fees paid for the Official Translation service level are non-refundable once the assigned translator has commenced work on the document.',
          'Fees paid for Notarization are subject to the terms of the relevant partner translator or notary and are generally non-refundable once the process has commenced.',
        ],
      },
      {
        id: 'method',
        heading: '7. Refund Method and Timeline',
        body: [
          'Approved refunds are processed through the same payment method used for the original transaction.',
          'Refunds are typically processed within 10 business days of approval. Processing time may vary depending on the payment provider.',
          'To request a refund, contact worldprimeonline@gmail.com with the order reference and a description of the issue.',
        ],
      },
      {
        id: 'lang-priority',
        heading: '8. Language Priority',
        body: [LANG_PRIORITY],
      },
    ],
  },

  disclaimer: {
    slug: 'disclaimer',
    title: 'Translation Status Disclaimer',
    metaTitle: 'Disclaimer — WPO Translations',
    metaDescription: 'Important disclaimer regarding the status and limitations of translations provided by WPO Translations.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'no-guarantee',
        heading: '1. No Guarantee of Third-Party Acceptance',
        body: [
          'Acceptance of the translation by third parties, including banks, universities, consulates, immigration authorities, and notaries, is not guaranteed and depends on the requirements of the relevant organization.',
          'Each institution, authority, and jurisdiction may have its own requirements regarding translation format, certification level, and accompanying documentation. The Customer must independently verify these requirements before using the Translated Document for any official purpose.',
        ],
      },
      {
        id: 'no-advice',
        heading: '2. No Legal, Immigration, or Professional Advice',
        body: [
          'Nothing on the Platform or in the Translated Documents constitutes legal, immigration, financial, medical, or notarial advice.',
          'The Provider does not advise Customers on whether a translation will be accepted for any specific application, procedure, or purpose. Customers should consult qualified legal, immigration, or professional advisors for such questions.',
        ],
      },
      {
        id: 'ai-limitations',
        heading: '3. AI-Assisted Processing Limitations',
        body: [
          'The Electronic Translation service level uses AI-based optical character recognition and machine translation. These systems may produce errors, omissions, or imprecisions, particularly with complex layouts, specialized terminology, handwritten content, or low-quality scans.',
          'The Provider does not warrant that the AI-generated translation is free from error or meets the accuracy standards required by any particular institution.',
        ],
      },
      {
        id: 'official-translation',
        heading: '4. Official Translation',
        body: [
          'An "Official Translation" within the meaning of these terms refers solely to the service level where a human translator reviews the output and provides their signature and the Provider stamp. This does not constitute a "certified translation" in the legal sense unless explicitly confirmed by the Provider in writing for a specific jurisdiction and use case.',
        ],
      },
      {
        id: 'notarization',
        heading: '5. Notarization',
        body: [
          'Notarization is available only where a partner process exists and is arranged separately.',
          'The availability of notarization is not guaranteed for all document types, language pairs, or jurisdictions. Where notarization is arranged, it is subject to the professional standards and terms of the certifying translator or notary.',
        ],
      },
      {
        id: 'verify',
        heading: '6. Customer Responsibility to Verify Requirements',
        body: [
          'Before submitting a Translated Document to any institution, authority, or third party, the Customer must independently verify that the format, certification level, and content of the translation meet the requirements of that recipient.',
          'The Provider is not liable for any adverse consequences, including rejection of an application, arising from the Customer\'s use of a Translated Document without verifying recipient requirements.',
        ],
      },
      {
        id: 'lang-priority',
        heading: '7. Language Priority',
        body: [LANG_PRIORITY],
      },
    ],
  },

  terms: {
    slug: 'terms',
    title: 'Website Terms of Use',
    metaTitle: 'Terms of Use — WPO Translations',
    metaDescription: 'Terms governing use of the WPO Translations website and platform.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'acceptance',
        heading: '1. Acceptance of Terms',
        body: [
          'By accessing or using the Platform at https://www.wpotranslations.org/, you agree to be bound by these Website Terms of Use. If you do not agree, please do not use the Platform.',
          'These Terms apply to all visitors, registered users, and Customers.',
        ],
      },
      {
        id: 'website-use',
        heading: '2. Permitted Use',
        body: [
          'The Platform may be used for the purposes of obtaining document translation services in accordance with the Public Offer Agreement.',
          'Users may access, browse, and use features of the Platform for personal or business document translation needs.',
        ],
      },
      {
        id: 'prohibited',
        heading: '3. Prohibited Activities',
        body: [
          'Users must not:',
          '• Upload documents for which they do not have the right to request translation.',
          '• Use the Platform for fraudulent, deceptive, or illegal purposes.',
          '• Upload documents containing prohibited content (child exploitation material, incitement to violence, material violating applicable law).',
          '• Attempt to reverse-engineer, decompile, or extract the Provider\'s software, models, or proprietary methods.',
          '• Use automated tools, bots, or scripts to access the Platform without prior written authorization from the Provider.',
          '• Interfere with or disrupt the Platform\'s infrastructure, systems, or services.',
          '• Attempt to gain unauthorized access to other users\' accounts or data.',
        ],
      },
      {
        id: 'ip',
        heading: '4. Intellectual Property',
        body: [
          'All content on the Platform, including but not limited to software, design, text, logos, and translation methodology, is the property of the Provider or its licensors and is protected by applicable intellectual property law.',
          'The Customer retains ownership of the source documents they upload. The Provider retains no ownership interest in Customer documents.',
          'The Translated Document is provided to the Customer for their personal or business use. The Customer may not resell or commercially redistribute Translated Documents without the Provider\'s prior written consent.',
        ],
      },
      {
        id: 'account',
        heading: '5. Account Responsibility',
        body: [
          'The Customer is responsible for maintaining the confidentiality of their account credentials and for all activities that occur under their account.',
          'The Customer must notify the Provider at worldprimeonline@gmail.com immediately upon becoming aware of any unauthorized use of their account.',
          'The Provider reserves the right to suspend or terminate accounts that violate these Terms.',
        ],
      },
      {
        id: 'service-availability',
        heading: '6. Service Availability',
        body: [
          'The Provider makes reasonable efforts to maintain Platform availability but does not guarantee uninterrupted, error-free access.',
          'The Platform may be temporarily unavailable due to maintenance, updates, or circumstances beyond the Provider\'s control.',
          'The Provider is not liable for any loss resulting from Platform unavailability.',
        ],
      },
      {
        id: 'links',
        heading: '7. Third-Party Links',
        body: [
          'The Platform may contain links to third-party websites. The Provider is not responsible for the content, privacy practices, or availability of such websites.',
        ],
      },
      {
        id: 'changes',
        heading: '8. Changes to Terms',
        body: [
          'The Provider may update these Terms at any time. Continued use of the Platform after the effective date of changes constitutes acceptance of the updated Terms.',
          'Significant changes will be communicated by email or by notice on the Platform.',
        ],
      },
      {
        id: 'lang-priority',
        heading: '9. Language Priority',
        body: [LANG_PRIORITY],
      },
      {
        id: 'contact',
        heading: '10. Contact',
        body: [
          'Provider: IE WorldPrimeOnline',
          'Address: Almaty, Kazybek bi st. 139/1',
          'Contact: worldprimeonline@gmail.com',
          'Website: https://www.wpotranslations.org/',
        ],
      },
    ],
  },

  partners: {
    slug: 'partners',
    title: 'Partner Terms',
    metaTitle: 'Partner Terms — WPO Translations',
    metaDescription: 'Terms for translators, notaries, agents, and referral partners working with WPO Translations.',
    effectiveDate: '2026-05-26',
    sections: [
      {
        id: 'intro',
        heading: '1. Scope and Partner Definition',
        body: [
          'These Partner Terms apply to any individual or entity who has entered into a separate partner agreement with WorldPrimeOnline (hereinafter "Provider").',
          '"Partner" includes certified translators, notaries, referral agents, immigration consultants, educational consultants, and other service providers who collaborate with the Provider under a written partner arrangement.',
        ],
      },
      {
        id: 'no-employment',
        heading: '2. Independent Contractor Status',
        body: [
          'Partners are independent contractors and not employees, agents, or legal representatives of the Provider. Nothing in the partner arrangement creates an employment relationship, partnership, joint venture, or agency.',
          'Partners are responsible for their own taxes, professional fees, insurance, and compliance with applicable law in their jurisdiction.',
        ],
      },
      {
        id: 'translator-responsibility',
        heading: '3. Translator and Notary Responsibilities',
        body: [
          'Translators who provide the Official Translation service level must hold appropriate professional qualifications recognized in their jurisdiction.',
          'The translator is responsible for the accuracy, completeness, and professional quality of any translation to which they affix their signature.',
          'Notaries who provide certification services are responsible for ensuring that their actions comply with applicable notarial law and professional standards.',
          'Partners providing translation or notarization services are personally and professionally liable for the services they render. The Provider\'s liability for Partner-rendered services is limited to the extent permitted by applicable law.',
        ],
      },
      {
        id: 'commission',
        heading: '4. Referral Commission and Commercial Terms',
        body: [
          'Referral commission rates and commercial terms are set out in the individual partner agreement signed between the Partner and the Provider.',
          'Commission terms: to be defined in the individual partner agreement.',
          'Payment of commissions is subject to the terms of the individual agreement and applicable law.',
        ],
      },
      {
        id: 'confidentiality',
        heading: '5. Client Data Confidentiality',
        body: [
          'Partners who receive client documents through the Platform are bound by strict confidentiality obligations.',
          'Partners must not disclose, retain beyond what is necessary, or use client documents or personal data for any purpose other than performing the contracted service.',
          'Partners must implement reasonable security measures to protect client data in their possession.',
        ],
      },
      {
        id: 'no-misleading',
        heading: '6. No Misleading Claims',
        body: [
          'Partners must not make any representation to clients that overstates the nature, status, or scope of the translations provided.',
          'Partners must not claim that Electronic Translations are certified, notarized, or officially recognized unless this is true for the specific service level delivered.',
          'Partners must not guarantee acceptance of translated documents by any authority, institution, or organization.',
          'Partners must not imply that they represent the Provider unless expressly authorized in writing.',
        ],
      },
      {
        id: 'termination',
        heading: '7. Termination of Partnership',
        body: [
          'Either party may terminate the partner arrangement in accordance with the notice provisions of the individual partner agreement.',
          'The Provider reserves the right to immediately suspend or terminate a Partner\'s access to the Platform if the Partner violates these Terms, engages in fraudulent activity, or causes harm to Customers.',
        ],
      },
      {
        id: 'lang-priority',
        heading: '8. Language Priority',
        body: [LANG_PRIORITY],
      },
      {
        id: 'contact',
        heading: '9. Contact for Partner Inquiries',
        body: [
          'Provider: IE WorldPrimeOnline',
          'Address: Almaty, Kazybek bi st. 139/1',
          'Contact: worldprimeonline@gmail.com',
          'Website: https://www.wpotranslations.org/',
        ],
      },
    ],
  },
};
