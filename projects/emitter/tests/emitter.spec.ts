import { TestBed } from '@angular/core/testing';
import { Component, Injectable, Injector } from '@angular/core';
import { State, Store, NgxsModule, StateContext } from '@ngxs/store';

import { Observable, of } from 'rxjs';
import { delay, take, tap } from 'rxjs/operators';

import { Emitter } from '../src/lib/core/decorators/emitter';
import { EMITTER_META_KEY, Emittable } from '../src/lib/core/internal/internals';
import { EmitterAction } from '../src/lib/core/actions/actions';
import { EmitStore } from '../src/lib/emit.service';
import { PayloadEmitter } from '../src/lib/core/decorators/payload-emitter';
import { NgxsEmitPluginModule } from '../src/lib/emit.module';

describe('Emitter', () => {
    interface Todo {
        text: string;
        completed: boolean;
    }

    it('static metadata should have `type` property same as in @Emitter() decorator', () => {
        @State({ name: 'bar' })
        class BarState {
            @Emitter({ type: '@@[bar]' })
            public static foo() {}
        }

        const BarFooMeta = BarState.foo[EMITTER_META_KEY];
        expect(BarFooMeta.type).toBe('@@[bar]');
    });

    it('static metadata should have default `type` property', () => {
        @State({ name: 'bar' })
        class BarState {
            @Emitter()
            public static foo() {}
        }

        const BarFooMeta = BarState.foo[EMITTER_META_KEY];
        expect(BarFooMeta.type).toBe('BarState.foo');
    });

    it('should add todo using @Emitter() decorator', () => {
        @State<Todo[]>({
            name: 'todos',
            defaults: []
        })
        class TodosState {
            @Emitter()
            public static addTodo(ctx: StateContext<Todo[]>, action: EmitterAction<Todo>) {
                ctx.setState([...ctx.getState(), action.payload!]);
            }
        }

        TestBed.configureTestingModule({
            imports: [
                NgxsModule.forRoot([TodosState]),
                NgxsEmitPluginModule.forRoot()
            ]
        });

        const store: EmitStore = TestBed.get(Store);

        store.emitter<Todo>(TodosState.addTodo).emit({
            text: 'buy coffee',
            completed: false
        });

        const todoLength = store.selectSnapshot<Todo[]>(state => state.todos).length;
        expect(todoLength).toBe(1);
    });

    it('should dispatch an action from the sub state', () => {
        @State({
            name: 'bar2',
            defaults: 10
        })
        class Bar2State {
            @Emitter()
            public static foo2({ setState }: StateContext<number>) {
                setState(20);
            }
        }

        @State({
            name: 'bar',
            defaults: {},
            children: [Bar2State]
        })
        class BarState {}

        TestBed.configureTestingModule({
            imports: [
                NgxsModule.forRoot([BarState, Bar2State]),
                NgxsEmitPluginModule.forRoot()
            ]
        });

        const store: EmitStore = TestBed.get(Store);
        store.emitter(Bar2State.foo2).emit();

        const bar2Value = store.selectSnapshot(state => state.bar).bar2;
        expect(bar2Value).toBe(20);
    });

    it('should throw an error that such `type` already exists', () => {
        try {
            @State({
                name: 'bar',
                defaults: 10
            })
            class BarState {
                @Emitter({ type: 'foo' })
                public static foo1() {}

                @Emitter({ type: 'foo' })
                public static foo2() {}
            }

            TestBed.configureTestingModule({
                imports: [
                    NgxsModule.forRoot([BarState]),
                    NgxsEmitPluginModule.forRoot()
                ]
            });
        } catch ({ message }) {
            expect(message).toBe('Method decorated with such type `foo` already exists');
        }
    });

    it('should dispatch an action using @Emitter() after delay', () => {
        @Injectable()
        class ApiService {
            private size = 10;

            public getTodosFromServer(length: number): Observable<Todo[]> {
                return of(this.generateTodoMock(length)).pipe(delay(1000));
            }

            private generateTodoMock(size?: number): Todo[] {
                const length = size || this.size;
                return Array.from({ length }).map(() => ({
                    text: 'buy some coffee',
                    completed: false
                }));
            }
        }

        @State<Todo[]>({
            name: 'todos',
            defaults: []
        })
        class TodosState {
            public static injector: Injector | null = null;

            constructor(injector: Injector) {
                TodosState.injector = injector;
            }

            @Emitter({ type: '@@[Todos] Set todos sync' })
            public static async setTodosSync({ setState }: StateContext<Todo[]>) {
                setState(
                    await TodosState.injector!
                        .get<ApiService>(ApiService)
                        .getTodosFromServer(10)
                        .toPromise()
                );
            }

            @Emitter({ type: '@@[Todos] Set todos' })
            public static setTodos({ setState }: StateContext<Todo[]>) {
                return TodosState.injector!
                    .get<ApiService>(ApiService)
                    .getTodosFromServer(5)
                    .pipe(
                        take(1),
                        tap(todos => setState(todos))
                    );
            }
        }

        TestBed.configureTestingModule({
            imports: [
                NgxsModule.forRoot([TodosState]),
                NgxsEmitPluginModule.forRoot()
            ],
            providers: [
                ApiService
            ]
        });

        const store: EmitStore = TestBed.get(Store);

        store
            .emitter<void>(TodosState.setTodosSync)
            .emit()
            .subscribe(() => {
                const todoLength = store.selectSnapshot<Todo[]>(state => state.todos).length;
                expect(todoLength).toBe(10);
            });

        store
            .emitter<void>(TodosState.setTodos)
            .emit()
            .subscribe(() => {
                const todoLength = store.selectSnapshot<Todo[]>(state => state.todos).length;
                expect(todoLength).toBe(5);
            });
    });

    it('should decorate property with @PayloadEmitter() decorator', () => {
        @State<Todo[]>({
            name: 'todos',
            defaults: []
        })
        class TodosState {
            @Emitter()
            public static addTodo() {}
        }

        @Component({ template: '' })
        class MockComponent {
            @PayloadEmitter(TodosState.addTodo)
            public addTodoAction: Emittable<Todo> | undefined;
        }

        TestBed.configureTestingModule({
            imports: [
                NgxsModule.forRoot([TodosState]),
                NgxsEmitPluginModule.forRoot()
            ],
            declarations: [
                MockComponent
            ]
        });

        const fixture = TestBed.createComponent(MockComponent);
        expect(typeof fixture.componentInstance.addTodoAction).toBe('object');
        expect(typeof fixture.componentInstance.addTodoAction!.emit).toBe('function');
    });

    it('should dispatch an action using property decorated with @PayloadEmitter()', () => {
        @State<Todo[]>({
            name: 'todos',
            defaults: []
        })
        class TodosState {
            @Emitter({ type: '@@[Todos] Add todo' })
            public static addTodo(ctx: StateContext<Todo[]>, action: EmitterAction<Todo>) {
                ctx.setState([...ctx.getState(), action.payload!]);
            }
        }

        @Component({ template: '' })
        class MockComponent {
            @PayloadEmitter(TodosState.addTodo)
            public addTodoAction: Emittable<Todo> | undefined;
        }

        TestBed.configureTestingModule({
            imports: [
                NgxsModule.forRoot([TodosState]),
                NgxsEmitPluginModule.forRoot()
            ],
            declarations: [
                MockComponent
            ]
        });

        const store: EmitStore = TestBed.get(Store);
        const fixture = TestBed.createComponent(MockComponent);

        fixture.componentInstance.addTodoAction!.emit({
            text: 'buy some coffee',
            completed: false
        });

        const todoLength = store.selectSnapshot<Todo[]>(state => state.todos).length;
        expect(todoLength).toBe(1);
    });
});
