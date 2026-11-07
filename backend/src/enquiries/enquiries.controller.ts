import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { EnquiriesService } from './enquiries.service';

export const ENQUIRY_RECEIVED =
  'Thank you. Your message has reached Studio Rags, and Rehana will reply by email.';

@Controller('contact')
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  /** FR-C13, and private-event enquiries (ADR-019). */
  @Public()
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  async create(@Body() dto: CreateEnquiryDto): Promise<{ message: string }> {
    await this.enquiries.create(dto);
    return { message: ENQUIRY_RECEIVED };
  }
}
