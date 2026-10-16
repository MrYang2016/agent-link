import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_COMPANY_ID } from '../constants';
import { Company } from '../entity/company.entity';
import { isDuplicateEntry } from '../duplicate';

@Injectable()
export class CompanySeed implements OnModuleInit {
  constructor(@InjectRepository(Company) private readonly companies: Repository<Company>) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.companies.findOne({ where: { id: DEFAULT_COMPANY_ID } });
    if (existing) return;
    try {
      await this.companies.insert({ id: DEFAULT_COMPANY_ID });
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
    }
  }
}
