import { Injectable, Logger } from '@nestjs/common';
import { EnquiryKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';

export type EnquiryOutcome = 'stored' | 'discarded';

@Injectable()
export class EnquiriesService {
  private readonly logger = new Logger(EnquiriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores the enquiry for the admin inbox. A filled honeypot is dropped
   * without a trace in the database, and the caller still sees success, so a
   * bot learns nothing from the response.
   */
  async create(dto: CreateEnquiryDto): Promise<EnquiryOutcome> {
    if (dto.website) {
      this.logger.warn('Contact form honeypot filled; enquiry discarded');
      return 'discarded';
    }

    const kind = dto.kind ?? EnquiryKind.GENERAL;
    const isPrivateEvent = kind === EnquiryKind.PRIVATE_EVENT;

    await this.prisma.enquiry.create({
      data: {
        kind,
        name: dto.name,
        email: dto.email,
        phone: dto.phone || null,
        message: dto.message,
        preferredDate:
          isPrivateEvent && dto.preferredDate
            ? new Date(dto.preferredDate)
            : null,
        guestCount: isPrivateEvent ? (dto.guestCount ?? null) : null,
      },
    });
    return 'stored';
  }
}
