import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CoursesModule } from './courses/courses.module';
import { SemestersModule } from './semesters/semesters.module';
import { CourseOfferingsModule } from './course-offerings/course-offerings.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { UsersModule } from './users/users.module';
import { SurveysModule } from './surveys/surveys.module';
import { SurveyVersionsModule } from './survey-versions/survey-versions.module';
import { QuestionsModule } from './questions/questions.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { StudentAccessModule } from './student-access/student-access.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { LecturerDashboardModule } from './lecturer-dashboard/lecturer-dashboard.module';
import { CommentsModule } from './comments/comments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    CoursesModule,
    SemestersModule,
    CourseOfferingsModule,
    EnrollmentsModule,
    UsersModule,
    SurveysModule,
    SurveyVersionsModule,
    QuestionsModule,
    EvaluationsModule,
    StudentAccessModule,
    SubmissionsModule,
    LecturerDashboardModule,
    CommentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}