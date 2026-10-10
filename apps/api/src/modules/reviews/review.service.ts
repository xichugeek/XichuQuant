import { Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";
import type { CreateReviewDto, UpdateReviewDto } from "./review.dto";

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.reviewNote.findMany({ orderBy: { createdAt: "desc" } });
  }

  async findOne(id: string) {
    const review = await this.prisma.reviewNote.findUnique({ where: { id } });
    if (!review) throw new NotFoundException("复盘记录不存在");
    return review;
  }

  create(dto: CreateReviewDto) {
    return this.prisma.reviewNote.create({
      data: { ...dto, symbol: dto.symbol?.trim().toUpperCase() },
    });
  }

  async update(id: string, dto: UpdateReviewDto) {
    await this.findOne(id);
    return this.prisma.reviewNote.update({
      where: { id },
      data: { ...dto, symbol: dto.symbol?.trim().toUpperCase() },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.reviewNote.delete({ where: { id } });
    return { deleted: true, id };
  }
}
