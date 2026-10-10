import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";

import { CreateReviewDto, UpdateReviewDto } from "./review.dto";
import { ReviewService } from "./review.service";

@Controller("reviews")
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get()
  findAll() {
    return this.reviewService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.reviewService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateReviewDto) {
    return this.reviewService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateReviewDto) {
    return this.reviewService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.reviewService.remove(id);
  }
}
